/**
* Agent runner using the PM2 process monitor
*/
var _ = require('lodash');
var async = require('async-chainable');
var colors = require('chalk');
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
					if (err) return next(err);
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
						if (err) return next(err);
						var status =
							_.isEqual(proc, [[]]) && _.isEqual(proc, []) ? 'stopped'
							: _.has(proc, '0.pm2_env.status') ? proc[0]['pm2_env'].status
							: 'unknown';

						// BUGFIX: Address error where PM2 claims the process is online but has exited already
						if (status == 'online' && proc[0].pid === 0) status = 'stopped';

						switch (status) {
							case 'launching':
							case 'online': // Still running - wait and try again
								session.context.log('Waiting for PM2 process', colors.cyan(this.procName), 'to complete', colors.grey(readable.relativeTime(startTick)));
								setTimeout(checkProcess, 1000);
								break;
							case 'stopping':
							case 'stopped':
								var exitCode = _.get(proc, '0.pm2_env.exit_code', 0);
								if (exitCode == 0) {
									next();
								} else {
									next(`Non-zero exit code: ${exitCode}`);
								}
								break;
							case 'errored':
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
				setTimeout(checkProcess, 1000);
			})
			// }}}
			.parallel({
				// Scoop the computed value from the cache {{{
				value: function(next) {
					session.cacher.get(session.cacheKey, next);
				},
				// }}}
				// Clean up the PM2 process {{{
				pm2Cleaner: function(next) {
					pm2.delete(this.procName, err => {
						if (err) session.context.warn('Error cleaning up process', colors.cyan(this.procName), '-', err);
						next();
					});
				},
				// }}}
			})
			.promise('value')
			.finally(()=> pm2.disconnect())
			// }}}
};
