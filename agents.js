#!/usr/bin/env node

/**
* Run an agent by its ID
* Usage: run-agent <agent-id>
*      : AGENT=<agent-id> run-agent
*
* @param {string} [process.env.AGENT] The ID of the agent to run
* @param {string} [process.env.AGENT_SETTINGS] JSON encoded object to pass to the agent to process
* @param {string} [process.env.AGENT_LAMBDA] If set the container is assumed to be a lambda process, all safeguards are removed and maximum resources are consumed
* @param {string} [process.env.AGENT_PATH] Use a series of CSV seperated directories as the root paths (this effectively sets agents.paths[])
* @param {string} [process.env.AGENT_PRELOAD] Run a JS file which gets passed the active agent session (use this to hook into the agent process). If the function returns a promise, the CLI will wait until its resolved before continuing. The following eventer events are supported: 'start', 'preEmit', 'postEmit', 'preSession', 'postSession', 'preRun', 'postRun', 'preDestroy', 'postDestroy', 'end' all events are emitted as `(session, agentInstance)` (until `postSession` session will be an empty object) which gives access to things like the `session.result` value
*/


var _ = require('lodash');
var Agents = require('.');
var agents; // Initialized version of the agents singleton
var colors = require('chalk');
var dump = require('dumper.js').dump;
var eventer = require('@momsfriendlydevco/eventer');
var fs = require('fs');
var fsPath = require('path');
var os = require('os');
var spawn = require('child_process').spawn;
var Commander = require('commander');
var commanderExtras = require('commander-extras');
var readable = require('@momsfriendlydevco/readable');
var Table = require('cli-table3');
var timestring = require('timestring');
var util = require('util');

var command = new Commander.Command();
var commander = commanderExtras(command); // Mutate only our custom command

var agentInitSettings = {
	autoInstall: false, // Don't set up Cron tasks
	allowImmediate: false, // Dont run (other) immediate agents
};

var program = commander.version(require('./package.json').version)
	.usage('[-d] [-r runner] [-c cache] [-o setting=value...] <agent-id>')
	.option('-l, --list', 'List all available agents')
	.option('-e, --enclose', 'Dont return errors, instead wrap the error inside the return value (implied when using the env AGENT)')
	.option('-r, --runner [inline|aws|pm2]', 'What runner to use with the agent')
	.option('-c, --cache [filesystem|redis...]', 'What caching method to force')
	.option('-o, --opts <key=val>', 'Specify an agent options in dotted notation (can be specified multiple times)', (v, total) => {
		var bits = [key, val] = v.split(/\s*=\s*/, 2);
		if (bits.length == 1) { // Assume we are just setting a flag to true
			_.set(total, key, true);
		}  else if (bits.length == 2) { // Assume key=val
			_.set(total, key, // Set the key, accepting various shorthand boolean values
				val === 'true' ? true
				: val === 'false' ? false
				: val
			);
		} else {
			throw `Failed to parse setting "${v}"`;
		}
		return total;
	}, {})
	.option('-n, --nice [number]', 'Set nice priority of the process (default 10)')
	.option('-d, --debug', 'Debugging convenience mode (imples `-prvm inline`)')
	.option('-p, --print', 'Output the result of the agent to STDOUT')
	.option('-r, --pretty', 'Pretty print the output')
	.option('-v, --verbose', 'Be verbose')
	.option('--max-time [limit]', 'Set the maximum cpu-time as a parsable timestring (default: "15m")')
	.option('--max-ram [limit]', 'Set the maximum RAM size in bytes (default: ~12gb)')
	.option('--max-procs [limit]', 'Set the maximum number of spawned processes (default: 1024)')
	.option('--max-files [limit]', 'Set the maximum number of files a process can open (default: 50)')
	.option('--no-human', 'Disable automatic human TTY detection')
	.option('--no-events', 'Disable output of any Agent event emitter content')
	.note('Config can also be stored in package.json under the `agents` key to be auto loaded')
	.parse(process.argv);

var options = program.opts();

var session = {};

var handleError = e => {
	if (e === 1 || e.toString() == 'Error: QUIT') return; // Exit quietly without error

	// Print the entire `e` object when `e.message` is not defined.
	if (Buffer.isBuffer(e)) {
		console.log(colors.blue('[agents]'), colors.red.bold('ERROR'), 'Agent error while running the agent "'+e.toString()+'"', colors.cyan(program.agent));
	} else if (e.message) {
		console.log(colors.blue('[agents]'), colors.red.bold('ERROR'), 'Agent error while running the agent "'+e.message+'"', colors.cyan(program.agent));
	} else {
		console.log(colors.blue('[agents]'), colors.red.bold('ERROR'), 'Agent error while running the agent', e, colors.cyan(program.agent));
	}

	if (Object.prototype.hasOwnProperty.call(session, 'emit')) {
		console.log(colors.blue('[agents]'), 'Cleaning up...', colors.cyan(options.agent));
		return session.emit('end', session, agents)
			.then(()=> console.log(colors.blue('[agents]'), 'Killing agent', colors.cyan(options.agent)))
			.then(()=> process.exit(1));
	} else {
		console.log(colors.blue('[agents]'), 'Killing agent', colors.cyan(options.agent));
		process.exit(1)
	}
};

// FIXME: Do we need to look for SIGINT or others?
process.on('uncaughtException', handleError);
process.on('unhandledRejection', handleError);

Promise.resolve()
	// Process environment variable mutators {{{
	.then(()=> {
		if (process.env.AGENT_PATH) {
			var usePaths = process.env.AGENT_PATH.split(/\s*,\s*/)
			agentInitSettings.paths = usePaths;
			if (options.verbose) console.log(colors.grey('Using environment paths override:', usePaths.join(', ')));
		}
	})
	// }}}
	// Check PWD/package.json for an `agents` key {{{
	.then(()=> fs.promises.readFile(fsPath.join(process.cwd(), 'package.json'))
		.then(contents => JSON.parse(contents))
		.then(config => {
			if (config.agents && typeof config.agents != 'object') {
				console.warn('PWD/package.json exists but the agents key is not an object');
			} else if (config.agents) {
				if (options.verbose) console.log(colors.grey('Reading agent config from PWD/package.json'));
				_.merge(agentInitSettings, config.agents);

				// Rewrite relative paths to absolute using the PWD
				agentInitSettings.paths = (agentInitSettings.paths || []).map(p => p.startsWith('./') ? fsPath.join(process.cwd(), p.substr(2)) : p);
			}
		})
		.catch(()=> false) // Ignore read errors
	)
	// }}}
	// Detect human using TTY {{{
	.then(()=> {
		if (process.stdout.isTTY && !options.debug && options.human) {
			console.log(colors.grey('You look like a human, switching on --debug mode. Use --no-human to disable human detection'));
			options.debug = true;
		}
	})
	// }}}
	// Process arguments / environment variables {{{
	.then(()=> {
		_.defaults(options, {
			maxTime: timestring(options.time || process.env.AGENT_TIMELIMIT || '15m'),
			maxProcs: 0,
			maxFiles: 0,
			print: false,
		});

		if (!program.args.length && process.env.AGENT) { // No args and has ENV `AGENT`
			options.agent = process.env.AGENT;

			// Enable various inline options:
			colors.enabled = true;
			_.defaults(options, {
				nice: 10,
				verbose: 10,
			});
		} else if (program.args.length == 1) {
			options.agent = program.args.pop();
		} else if (program.args.length > 1) {
			throw new Error('Only one agent can be run at a time');
		} else if (options.list) {
			// List mode - do nothing
		} else {
			throw new Error('No agent-id given!');
		}

		if (_.isUndefined(options.maxRam)) {
			options.maxRam = 1024 * 1024 * 1024 * 12; // 12gb
		} else {
			options.maxRam = parseInt(options.maxRam);
			if (isNaN(options.maxRam)) throw new Error('Invalid maximum RAM - must be a number of bytes');
		}

		if (process.env.AGENT_SETTINGS) options.opts = JSON.parse(process.env.AGENT_SETTINGS);

		if (process.env.AGENT_LAMBDA) {
			_.defaults(options, {
				runner: 'inline',
				nice: 0,
				maxTime: 0,
				maxRam: 0,
				maxProcs: 0,
				maxFiles: 0,
			});
		}

		if (options.debug) {
			_.defaults(options, {
				runner: 'inline',
				print: true,
				pretty: true,
				verbose: 2,
			});
		}
	})
	// }}}
	// Set the nice level and other limits {{{
	.then(()=> Promise.all([
		// Set the nice level {{{
		new Promise(resolve => {
			if (!options.nice) return resolve();
			console.log(colors.blue('[agents]'), 'Switching process', colors.cyan(`PID #${process.pid}`), 'niceness to', colors.cyan(options.nice || 10));
			if (_.isFunction(os.setPriority)) {
				os.setPriority(process.nice || 10);
			} else {
				console.log(colors.blue('[agents]'), colors.yellow('WARNING'), 'Node', colors.cyan('>10.10.x'), 'required to set prirority level. Current version', colors.cyan(process.version), '- skipped');
			}
			resolve();
		}),
		// }}}
		// Set the time limit {{{
		new Promise(resolve => {
			var args = [];
			var limits = [];

			if (options.maxTime > 0) {
				args.push(`--cpu=${options.maxTime}`);
				limits.push('CPU time=' + colors.cyan(options.maxTime));
			}
			if (options.maxRam > 0) {
				args.push(`--data=${options.maxRam}`);
				limits.push('RAM=' + colors.cyan(readable.fileSize(options.maxRam)));
			}
			if (options.maxProcs > 0) {
				args.push(`--nproc=${options.maxProcs}`);
				limits.push('Sub procs=' + colors.cyan(options.maxProcs));
			}
			if (options.maxFiles > 0) {
				args.push(`--nofile=${options.maxFiles}`);
				limits.push('Files=' + colors.cyan(options.maxFiles));
			}

			if (!args.length) return resolve(); // Nothing to do

			console.log(colors.blue('[agents]'), 'Setting process', colors.cyan(`PID #${process.pid}`), 'limits:', limits.join(', '))
			spawn('prlimit', ['--pid', process.pid].concat(args), {stdio: 'inherit'})
				.on('error', err => {
					console.log(colors.blue('[agents]'), colors.yellow('WARNING'), '`prlimits` returned error', colors.red(err));
					resolve();
				})
				.on('close', code => {
					if (code != 0) console.log(colors.blue('[agents]'), colors.yellow('WARNING'), '`prlimits` exited with code', colors.red(code));
					resolve();
				});
		}),
		// }}}
	]))
	// }}}
	// Setup the agents module {{{
	.then(()=> {
		agents = new Agents({
			...agentInitSettings,
			cache: options.cache ? {modules: [options.cache], calculate: ()=> options.cache} : undefined,
			runner: options.runner ? {modules: [options.runner], calculate: ()=> options.runner} : undefined,
		});
		agents.set(options.opts);
	})
	// }}}
	// Include the preload file {{{
	.then(()=> eventer.extend(session))
	.then(()=> {
		if (!process.env.AGENT_PRELOAD) return;
		if (options.verbose) console.log(colors.grey('Including the preload file:', process.env.AGENT_PRELOAD));
		return Promise.resolve(require(process.env.AGENT_PRELOAD)(session))
	})
	.then(()=> session.emit('start', session, agents))
	// }}}
	// Add event handler (unless --no-events) {{{
	.then(()=> {
		if (!options.events) {
			if (options.verbose) console.log(colors.grey('Ignoring event output due to --no-events'));
			return
		}

		agents
			.on('init', ()=> console.log('Created agents interface'))
			.on('ready', ()=> console.log('Agents interface ready'))
			.on('destroy', ()=> console.log('Destroying agents interface'))
			.on('destroyed', ()=> console.log('Destroyed agents interface'))
			.on('refreshWarn', (path, msg) => console.log(colors.yellow('WARNING'), colors.cyan(path), msg))
			.on('refresh', ids => console.log('Loaded agents:', ids.map(i => colors.cyan(i)).join(', ')))
			.on('tick', id => console.log('Refreshing agent', colors.cyan(id), 'from cron timing', colors.cyan(agents.agents[id].timing)))
			.on('scheduled', id => console.log('Installed agent', colors.cyan(id), 'with timing', colors.cyan(agents.agents[id].timing)))
			.on('runImmediate', id => console.log('Agent', colors.cyan(id), 'marked for immediate run!'))
			.on('log', (session, ...msg) => console.log(...msg))
			.on('warn', (session, ...msg) => console.warn(...msg))
	})
	// }}}
 	// Init {{{
	.then(()=> session.emit('preInit', session, agents))
	.then(()=> { // Override the session settings if we have command line values
		if (options.cache) agents.set({cache: {modules: [options.cache], calculate: ()=> options.cache}});
		if (options.runner) agents.set({runner: {modules: [options.runner], calculate: ()=> options.runner}});
	})
 	.then(()=> agents.init())
	.then(()=> {
		if (!options.list && !agents.has(options.agent)) throw new Error(`Invalid agent-id: "${options.agent}"`);
	})
	.then(()=> session.emit('postInit', session, agents))
	// }}}
	// Run in list mode (if --list) {{{
	.then(()=> {
		if (!options.list) return;

		var table = new Table({
			head: ['Agent ID', 'Timing', 'Expires', 'Data?', 'Show?', 'Clear on build?', 'Methods'],
			chars: {'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': ''},
		});

		if (_.size(agents._agents)) {
			_(agents._agents)
				.keys()
				.sort()
				.forEach(id => {
					table.push([
						id,
						agents._agents[id].timing || '',
						agents._agents[id].expires || '',
						agents._agents[id].hasReturn ? 'X' : '',
						agents._agents[id].show ? 'X' : '',
						agents._agents[id].clearOnBuild ? 'X' : '',
						agents._agents[id].methods.join(', '),
					]);
				});

			console.log(table.toString());
		} else {
			console.log('No agents found');
		}

		throw new Error('QUIT');
	})
	// }}}
	// Run the agent {{{
	.then(()=> session.emit('preSession', session, agents))
	.then(()=> agents.createSession(options.agent, options.opts)) // Expand dummy session with real details
	.then(createdSession => Object.assign(session, createdSession))
	.then(()=> session.emit('postSession', session, agents))
	.then(()=> {
		if (options.verbose) {
			console.log(colors.blue('[agents]'), 'Going to run the agent', colors.cyan(session.agent));
			console.log(colors.blue('[agents]'), '... with settings:', util.inspect(session.agentSettings, {depth: null, colors: true}))
			console.log(colors.blue('[agents]'), '... using the',  colors.cyan(session.runner), 'runner');
			console.log(colors.blue('[agents]'), '... via the', colors.cyan(session.cache), 'cache');
			console.log(colors.blue('[agents]'), '... and saving as the cache key', colors.cyan(session.cacheKey));
		}
		return session;
	})
	.then(()=> session.emit('preRun', session, agents))
	.then(()=> agents.run(session).then(res => session.result = res))
	.then(()=> session.emit('postRun', session, agents))
	// }}}
	// Output the result (if --print || --output) {{{
	.then(()=> {
		if (options.print) {
			console.log(colors.bold.blue('RESULT:'));
			dump(session.result);
		}
	})
	// }}}
	// Flush cache {{{
	.then(()=> session.emit('preDestroy', session, agents))
	.then(()=> agents.destroy())
	.then(()=> session.emit('postDestroy', session, agents))
	// }}}
	// End {{{
	.catch(handleError)
	.finally(()=> {
		if (options.agent) {
			console.log(colors.blue('[agents]'), 'Finished running agent', colors.cyan(options.agent));
			if (process.exitCode) return; // Already exited.

			if (Object.prototype.hasOwnProperty.call(session, 'emit')) {
				console.log(colors.blue('[agents]'), 'Cleaning up...', colors.cyan(options.agent));
				return session.emit('end', session, agents)
					.then(()=> console.log(colors.blue('[agents]'), 'Exiting agent', colors.cyan(options.agent)))
					.then(()=> process.exit(0));
			} else {
				console.log(colors.blue('[agents]'), 'Exiting agent', colors.cyan(options.agent));
				process.exit(0)
			}
		} else {
			process.exit(0);
		}
	})
	// }}}
