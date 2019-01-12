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
			.set('procName', `agent-${session.cacheKey}`)
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
				pm2.start(`${__dirname}/../run-agent`, {
					name: this.procName,
					args: [session.cacheKey], // NOTE: This doesn't work due to the way that PM2 wraps the node script, maybe one day it will be supported
					cwd: `${__dirname}/..`,
					env: {
						NODE_ENV: process.env.NODE_ENV,
						AGENT: session.agent,
						AGENT_SETTINGS: JSON.stringify(session.agentSettings),
						AGENT_CACHE: session.cache,
					},
					autorestart: false,
					interpreter: 'node',
					interpreterArgs: ['--max-old-space-size=12288'],
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
