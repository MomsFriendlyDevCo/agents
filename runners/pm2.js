/**
* Agent runner using the PM2 process monitor
*/
var _ = require('lodash');
var async = require('async-chainable');
var colors = require('chalk');
var debug = require('debug')('agents:pm2');
var fs = require('fs');
var pm2 = require('pm2');
var readable = require('@momsfriendlydevco/readable');
var util = require('util');

module.exports = {
	id: 'pm2',
	exec: session =>
		async()
			.set('procName', session.settings.runner.pm2.procName(session.cacheKey))
			// Connect to PM2 {{{
			.then('pm2', function(next) {
				pm2.connect(next);
			})
			// }}}
			// Check if the process is already registered {{{
			.then(function(next) {
				pm2.describe(this.procName, (err, proc) => {
					if (err || !proc || !proc.length || _.isEqual(proc, [[]]) || _.isEqual(proc, [])) return next(); // Process doesn't exist - continue on
					var status = _.get(proc, '0.pm2_env.status');
					session.context.warn('Process', colors.cyan(this.procName), 'already exists and has the status', colors.cyan(status), 'terminating...');
					pm2.delete(this.procName, ()=> next());
				});
			})
			// }}}
			// Create the process {{{
			.then('pid', function(next) {
				session.context.log('Spawning PM2 process', colors.cyan(this.procName));
				pm2.start(session.settings.runner.pm2.execFile, {
					name: this.procName,
					args: [],
					cwd: session.settings.runner.pm2.cwd,
					env: session.settings.runner.pm2.env(session),
					autorestart: false,
					interpreter: session.settings.runner.pm2.execFileInterpreter,
					interpreterArgs: session.settings.runner.pm2.execFileInterpreterArgs,
				}, (err, proc) => {
					if (err) {
						debug('pm2 start error', err);
						return next(err);
					}
					// Wait at least one second before continuing
					next(null, proc[0].process.pid);
				});
			})
			// }}}
			// Poll the process until it finishes {{{
			.then(function(next) {
				var startTick = Date.now();
				var checkProcess = ()=> {
					pm2.describe(this.procName, (err, proc) => {
						if (err) {
							debug('pm2 describe error', err);
							return next(err);
						}

						var status =
							_.isEqual(proc, [[]]) && _.isEqual(proc, []) ? 'stopped'
							: _.has(proc, '0.pm2_env.status') ? proc[0]['pm2_env'].status
							: 'unknown';

						if (status == 'online' && proc[0].pid === 0) status = 'stopped';

						switch (status) {
							case 'launching':
							case 'online': // Still running - wait and try again
								session.context.log('Waiting for PM2 process', colors.cyan(this.procName), 'to complete', colors.grey(readable.relativeTime(startTick)));
								setTimeout(checkProcess, session.settings.checkProcess);
								break;
							case 'stopping':
							case 'stopped':
								var exitCode = _.get(proc, '0.pm2_env.exit_code', 0);
								if (exitCode == 0) {
									if (!session.settings.runner.pm2.logFileScan) return next();
									// NOTE: Due to the insane way PM2 doesn't let you know if a process was zapped by it we have to watch the logs, fetch backwards for X lines, scope for stuff relevent to our process then filter by that
									var procStarted = new Date(_.get(proc, '0.pm2_env.created_at'));
									procStarted.setMilliseconds(0); // Remove millisecond component as PM2 doesn't have this same grain

									var procName = _.get(proc, '0.pm2_env.name');
									var fileHandle;
									Promise.resolve()
										.then(()=> fs.promises.open(session.settings.runner.pm2.logFilePath, 'r'))
										.then(fh => fileHandle = fh)
										.then(()=> fileHandle.stat())
										.then(stats => fileHandle.read(Buffer.alloc(session.settings.runner.pm2.logFileTailSize), 0, session.settings.runner.pm2.logFileTailSize, stats.size - session.settings.runner.pm2.logFileTailSize))
										.then(res => {
											fileHandle.close();
											return res.buffer.toString()
										})
										.then(content => content
											.split('\n')
											.slice(-5)
											.map(line => {
												var bits;
												if (bits = /^(?<date>[\d\-T:]+?): PM2 log: pid=(?<pid>\d+) msg=(?<msg>.*)$/.exec(line)) {
													return {
														...bits.groups,
														type: 'processKill',
														pid: parseInt(bits.groups.pid),
														date: new Date(bits.groups.date),
													}
												} else if (bits = /^(?<date>[\d\-T:]+?): PM2 log: App \[(?<name>.+?):(?<instance>\d+)\] exited with code \[(?<exitCode>\d+)\] via signal \[(?<signal>SIGTERM|SIGKILL)\]$/.exec(line)) {
													return {
														...bits.groups,
														type: 'processSignal',
														instance: parseInt(bits.groups.instance),
														exitCode: parseInt(bits.groups.exitCode),
														date: new Date(bits.groups.date),
													};
												} else if (bits = /^(?<date>[\d\-T:]+?): PM2 log: PM2 successfully stopped$/.exec(line)) {
													return {type: 'pm2Kill'};
												}
											})
											.filter(item =>
												item // Remove empty data
												&& (
													(
														item.type == 'processKill'
														&& item.pid == this.pid
														&& item.date >= procStarted // Has occured since we started the process
													)
													|| (
														item.type == 'processSignal'
														&& item.name == procName
														&& item.date >= procStarted
													)
													|| (
														item.type == 'pm2Kill'
													)
												)
											)
										)
										.then(items => {
											var match;
											if (items.some(item => item.type == 'processKill')) {
												next('Process killed by PM2');
											} else if (match = items.find(item => item.type == 'processSignal')) {
												next(`Proceess killed by system (${match.signal} exit code ${match.exitCode})`);
											} else if (items.some(item => item.type == 'pm2Kill')) {
												next('PM2 God is dead');
											} else {
												next();
											}
										})
								} else {
									var logPath = _.get(proc, '0.pm2_env.pm_err_log_path', '');
									debug('pm2 stopped error', exitCode, logPath);
									next(`Non-zero exit code: ${exitCode} see ${logPath}`);
								}
								break;
							case 'errored':
								debug('pm2 errored');
								next('PM2 process errored out');
								break;
							case 'unknown':
								session.context.warn('When asked to describe proc', colors.cyan(this.procName), 'PM2 returned:', util.inspect(proc, {depth: null, colors: true}));
								next('Unknown PM2 process status');
								break;
							default:
								next(`Unknown PM2 status: ${status}`);
						}
					});
				};
				setTimeout(checkProcess, session.settings.checkProcess);
			})
			// }}}
			.parallel({
				// Scoop the computed value from the cache {{{
				value: function() {
					return session.cacher.get(session.cacheKey);
				},
				// }}}
				// Clean up the PM2 process {{{
				pm2Cleaner: function(next) {
					pm2.delete(this.procName, err => {
						if (err) {
							debug('pm2 delete error', err);
							session.context.warn('Error cleaning up process', colors.cyan(this.procName), '-', err);
						}
						next();
					});
				},
				// }}}
			})
			.promise('value')
			.finally(()=> pm2.disconnect())
			// }}}
};
