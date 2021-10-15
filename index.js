/**
* Agents
* This unit loads all *.agents.js files as agent instances and allows calling via `.get(AGENT)` [cached] or `.run(AGENT)` [immediate run]
* It is a cross between a cron job and a caching module
* For example to load all widgets every 3 hours there should be a widgets.agents.js file which exports a callback which will get paged every 3 hours with a value, this is cached and can be returned via get()
*
* @param {Object} [options] Optional options to use
* @param {boolean} [options.autoInit=false] Automatically run `agents.init()` when setting up, NOTE: This is disabled by default because some runners / caches need setting up via async
* @param {boolean} [options.autoInstall=true] Whether any discovered agents should be installed as a cronjob
* @param {boolean} [options.allowImmediate=true] Allow any agent marked as 'immediate' to run whehn registering
* @param {number} [options.logThrottle=250] How long to pause between agent context logThrottled updates
*
* @example In the widgets.agents.js file
* module.exports = {
*   id: 'widgets',
*   timing: '0 * * * *', // Every hour
*   worker: (finish) => { complexOperation(finish) }
* };
* @example Somewhere else in the application
* agents.get('widgets', (err, value) => { ... });
*/

var _ = require('lodash').mixin(require('lodash-keyarrange'));
var argy = require('argy');
var async = require('async-chainable');
var Cache = require('@momsfriendlydevco/cache');
var colors = require('chalk');
var crypto = require('crypto');
var cronTranslate = require('cronstrue').toString;
var debug = require('debug')('agents:core');
var eventer = require('@momsfriendlydevco/eventer');
var scheduler = require('@momsfriendlydevco/scheduler');
var fspath = require('path');
var glob = require('globby');
var timestring = require('timestring');
var util = require('util');

function Agents(options) {
	var agents = this;

	agents.settings = _.defaultsDeep(options, {
		autoInit: false,
		autoInstall: true,
		allowImmediate: true,
		logThrottle: 250,
		paths: [
			`${__dirname}/examples/**/*.agent.js`,
			'!node_modules',
		],
		keyRewrite: key => key,
		cache: {
			init: false,
			modules: ['filesystem', 'memory'],
			calculate: session => session.settings.cache.modules[0],
			memcached: {
				options: {
					maxValue: 1048576 * 10, // 10mb
				},
			},
			mongodb: {
				uri: 'mongodb://localhost/agents',
				collection: 'caches',
			},
			redis: {
				host: 'server.com',
				port: 6379,
				password: 'my-super-secure-password',
			},
		},

		runner: {
			modules: ['inline'],
			calculate: session => 'inline',
			pm2: {
				procName: cacheKey => cacheKey,
				execFile: `${__dirname}/run-agent`,
				execFileInterpreter: 'node',
				execFileInterpreterArgs: ['--max-old-space-size=12288'],
				cwd: __dirname,
				env: session => ({
					NODE_ENV: process.env.NODE_ENV,
					AGENT: session.agent,
					AGENT_SETTINGS: JSON.stringify(session.agentSettings),
					AGENT_CACHE: session.cache,
					AGENT_LAMBDA: 1,
				}),
				logFileScan: true, //
				logFilePath: `${process.env.HOME}/.pm2/pm2.log`,
				logFileTailSize: 2048,
			},
		},

		agentDefaults: {
			hasReturn: true,
			expires: false,
			immediate: false,
			clearOnBuild: false,
			show: true,
			methods: ['pm2', 'inline'],
		},
	});


	/**
	* Set one or more setting values for this object
	* This can either be a single key + val or an object to be merged into the settings
	* @param {string|Object} key Either the dotted notation path to set or an object to be merged
	* @param {*} [val] The value to set
	* @returns {Object} This chainable object
	*/
	agents.set = (key, val) => {
		if (_.isObject(key)) {
			_.merge(agents.settings, key);
		} else {
			_.set(agents.settings, key, val);
		}
		return agents;
	};


	/**
	* Storage for all loaded caches
	*/
	agents.caches = {};


	/**
	* Storage for all loaded runners
	*/
	agents.runners = {
		inline: require('./runners/inline'),
		pm2: require('./runners/pm2'),
	};


	/**
	* Collection of agent services
	* All are loaded from **.agent.js
	* @var {Object <Object>} Object where all keys are the agen name (stripped of the `.agent.js` suffix), all values should be an object
	* @param {function} worker The callback function to run when the agents timing expires
	* @param {string} [timing] A cron compatible expression on when the agents should run. If omitted no cronJob is registered
	* @param {string} [expires] How long the value should be retained (set this to something like '1h' if you dont want to recalc the value with custom settings each time)
	* @param {string} id The ID of the agent to store in the cache
	* @param {boolean} [hasReturn=true] Whether the agent is expected to return something
	* @param {boolean} [immediate=false] Whether to run the agents as soon as the server is ready - should only be used for debugging purposes (only works if app.config.agents.allowImmediate is true)
	* @param {array} [methods=['inline', 'pm2']] Which methods are allowed to run the agent, these are processed in first->last priority order with the first matching being used
	* @param {boolean} [show=false] Whether the agent should show up in the agent listing
	* @param {boolean} [clearOnBuild=true] Whether the agent contents should invalidate on each build
	* @param {CronJob} [cronJob] The CronJob object calculated from the timing string. Only available if timing is specified
	*
	* @this (Result of createContext()) Additional properties `cacheKey`, `method`, `cache` are available during run()
	*/
	agents._agents = {};


	/**
	* Tracker for agent sessions currently running
	* The key in each case is the session.cacheKey with the value being the session object
	* Anything waiting for the session to complete can attach to the `promise` object which will resolve / reject when the session finishes
	* @var {Object}
	*/
	agents._running = {};


	/**
	* Refresh all agent services
	* @param {function} finish Callback to call when done as (err, agents)
	* @returns {Promise} A promise which will resolve when agents have been refreshed
	* @emits refreshWarn Emitted as `(path, msg)` if a warning message is encounted
	* @emits refresh Emitted as `(agentIds[])` when refreshing completes
	*/
	agents.refresh = ()=>
		Promise.resolve()
			.then(()=> glob(agents.settings.paths, {ignore: ['node_modules']}))
			.then(paths => {
				var seenAgents = new Set();

				return agents._agents = _(paths)
					.map(path => {
						try {
							return _.set(require(path), 'path', path);
						} catch (e) {
							agents.emit('refreshWarn', `Failed to parse "${path}" - ${e.toString()}`);
						}
					})
					.filter() // Remove failed modules
					.map(mod => _.defaults(mod, agents.settings.agentDefaults))
					.filter(mod => {
						var missing = ['id', 'hasReturn', 'worker']
							.filter(f => !_.has(mod, f));

						if (seenAgents.has(mod.id)) {
							agents.emit('refreshWarn', mod.path, `has duplicate id "${mod.id}" - skipped`);
							return false;
						} else if (missing.length) {
							agents.emit('refreshWarn', mod.path, `file does not have the required keys ${missing.map(m => `"${m}"`).join(', ')} (or maybe look like a valid agent?) - skipped`);
							return false;
						} else {
							seenAgents.add(mod.id);
							return true;
						}
					})
					.mapKeys(mod => mod.id)
					.mapValues(mod => mod)
					.value()
			})
			// }}}
			.then(()=> agents.emit('refresh', _.keys(agents._agents).sort()))


	/**
	* Check whether then given agent ID is valid
	* @param {string} id The agent ID to check
	* @returns {boolean} Whether the agent is valid
	*/
	agents.has = id => !! agents._agents[id];


	// init() + init*() {{{
	/**
	* Perform all initialization actions
	* If you want to override this call the agents.init* functions yourself in approximately the below order
	* This function is called automatically if `settings.autoInit` is truthy
	* @returns {Promise} A promise which will resolve as the agent interface when its finished loading
	* @emits init Emitted as `()` when the agents interface is being initiated
	* @emits ready Emitted as `()` when the agents interface is ready for use
	* @emits tick Emitted as `(agent)` when refreshing an agent
	* @emits scheduled Emitted as `(agentId)` when an agent has been scheduled
	* @emits runImmediate Emitted as `(agentId)` when an agent is going to run because its marked for immediate execution
	*/
	agents.init = ()=>
		Promise.resolve()
			.then(()=> agents.emit('init'))
			.then(()=> { // Load available agents (if we havn't already)
				if (agents.agents && !_.isEmpty(agents.agents)) return;
				return agents.refresh();
			})
			.then(()=> agents.initCaches())
			.then(()=> agents.initCron()) // Setup all agent cron timings
			.then(()=> { // Run all agents marked as immediate
				if (!agents.settings.allowImmediate) return; // Immediate execution is disabled
				return Promise.all(
					_.values(agents._agents)
						.filter(agent => agent.immediate)
						.map(agent => {
							agents.emit('runImmediate', agent.id);
							agents.run(agent.id);
						})
				);
			})
			.then(()=> scheduler.start())
			.then(()=> agents.emit('ready'))
			.then(()=> this)


	/**
	* Setup all cache storage
	*/
	agents.initCaches = ()=>
		Promise.resolve()
			.then(()=> agents.caches = {})
			.then(()=> Promise.all(agents.settings.cache.modules.map(id => {
				agents.caches[id] = new Cache({...agents.settings.cache, modules: [id]});
				return agents.caches[id].init();
			})))


	/**
	* Setup all agent cron timings
	*/
	agents.initCron = ()=>
		Promise.all(
			_.values(agents._agents).map(agent => {
				if (!agent.timing || !agents.settings.autoInstall) return; // No timing - don't bother registering
				agent.cronJob = new scheduler.Task(
					agent.timing,
					()=> {
						agents.emit('tick', agent.id);
						return agents.run(agent.id);
					}
				);

				return agents.emit('scheduled', agent.id);
			})
		)
	// }}}


	/**
	* Destroy the agents instance, flushing all caches and releasing all resources
	* @returns {Promise} Promise resolved when the agent singleton has been destroyed safely
	* @emits destroy Emitted as `()` when the agent interface is being destroyed
	* @emits destroyed Emitted as `()` when the agent interface has been destroyed
	*/
	agents.destroy = ()=>
		Promise.resolve()
			.then(()=> this.emit('destroy'))
			.then(()=> Promise.all([
				// Destroy all runners if they expose a 'destroy' function
				()=> Promise.all(_.values(this.runners).filter(r => _.isFunction(r.destroy)).map(r => r.destroy())),

				// Destroy all caches
				()=> Promise.all(_.values(this.caches).map(c => c.destroy())),
			]))
			.then(()=> scheduler.pause())
			.then(()=> this.emit('destroyed'))


	/**
	* Compute a unique hashed key from a combination of the ID and settings object
	* NOTE: Any key beginning with '$' is omitted
	* @param {string} id The ID of the worker
	* @param {Object} [settings] Optional settings structure
	*/
	agents.getKey = function(id, settings) {
		var hashable = _(settings)
			.pickBy((v, k) => !k.startsWith('$'))
			.keyArrangeDeep()
			.value()

		return agents.settings.keyRewrite(
			_.isEmpty(hashable)
				? id
				: id + '-' +
					crypto.createHash('sha256')
						.update(_.isString(hashable) || _.isNumber(hashable) || _.isBoolean(hashable) ? hashable : JSON.stringify(hashable))
						.digest('hex')
		);
	};


	/**
	* Utility function to create a defered promise
	* This is an object with `{promise, resolve(), reject()}` keys
	* @returns {Defer} A deferred promise
	*/
	agents.createDefer = function() {
		var defer = {};
		defer.promise = new Promise((resolve, reject) => {
			defer.resolve = resolve;
			defer.reject = reject;
		});
		return defer;
	};


	/**
	* Create an agent session object
	* This function is automatically called by agents.get() + agents.run() to create the actual agent configuration
	* @param {string} id The ID of the agent
	* @param {Object} [agentSettings] Optional settings to pass to the agent
	* @param {Object} [settings] Settings to change the behaviour of this function
	* @param {string} [settings.cacheKey] Force the use of a cacheKey
	* @param {string} [settings.runner] Runner to use when running the agent - if specified this overrides agents.settings.runner.calculate()
	* @param {function} finish Callback to call as (err, result)
	* @returns {Promise} A promise which resolves with the agent session
	*/
	agents.createSession = (id, agentSettings = {}, settings = {}) =>
		Promise.resolve()
			// Sanity checks {{{
			.then(()=> {
				if (!agents._agents[id]) throw new Error(`Agent "${id}" is invalid`);
			})
			// }}}
			// Create base session object {{{
			.then(()=> {
				return {
					agent: id,
					agentSettings,
					cacheKey: settings.cacheKey || agents.getKey(id, agentSettings),
					runner: false,
					cache: false,
					startTime: Date.now(),
					worker: agents._agents[id],
					settings: agents.settings,
					defer: agents.createDefer(),
				};
			})
			// }}}
			// Determine runner {{{
			.then(session => {
				session.runner = settings.runner || agents.settings.runner.calculate(session);
				if (!session.runner) throw new Error('Unable to determine agent runner');
				if (!agents.runners[session.runner]) throw new Error(`Invalid agent runner: "${session.runner}"`);
				return session;
			})
			// }}}
			// Determine cache method {{{
			.then(session => {
				session.cache = settings.cache || agents.settings.cache.calculate(session);
				if (!session.cache) throw new Error('Unable to determine agent cache');
				if (!agents.caches[session.cache]) throw new Error(`Invalid agent cache: "${session.cache}"`);
				return session;
			})
			// }}}
			// Create context {{{
			.then(session => _.set(session, 'context', agents.createContext(session)))
			// }}}
			// Allocate cacher {{{
			.then(session => _.set(session, 'cacher', agents.caches[session.cache]))
			// }}}


	/**
	* Retrieve a agent value thats been cached OR run the agents and get that result
	* This function really just checks if a cache exists, if so it uses that, if not the worker is run then the result is cached + used
	* @param {string|Object} id The ID of the agent to return the value of OR a session object from createSession()
	* @param {Object} [agentSettings] Optional settings to pass to the agent
	* @param {Object} [settings] Settings to change the behaviour of this function, see createSession() for the list of valid options
	* @param {string} [settings.cacheMethod="get"] The cache method to run
	* @param {boolean} [settings.lazy=false] If non-lazy (i.e. `true`) agent.run() will be invoked if no value was found rather than returning undefined
	* @returns {Promise} A promise which resolves with the agent result
	*/
	agents.get = (id, agentSettings = {}, settings = {}) => {
		var session;
		return Promise.resolve()
			.then(()=> _.isObject(id) ? id : agents.createSession(id, agentSettings, settings)) // Calculate a session or use the session given
			// Try to access an existing cache value - resolve this promise chain if we have one, otherwise call run()
			.then(res => session = res)
			.then(() => agents.caches[session.cache][settings.cacheMethod || 'get'](session.cacheKey))
			.then(val =>
				val ? val
				: !settings.lazy ? agents.run(session)
				: undefined
			);
	}


	/**
	* Get the approximate size of the object in bytes
	* This function really just wraps get with `{lazy: true, cacheMethod: 'size'}`
	* @param {string|Object} id The ID of the agent to return the value of OR a session object from createSession()
	* @param {Object} [agentSettings] Optional settings to pass to the agent
	* @param {Object} [settings] Settings to change the behaviour of this function, see createSession() for the list of valid options
	* @returns {Promise} A promise which resolves with the agent result
	*/
	agents.getSize = (id, agentSettings = {}, settings = {}) =>
		agents.get(id, agentSettings, {...settings, lazy: true, cacheMethod: 'size'})


	/**
	* Create an agent context for the running session
	* The context gets attached to agents._agents[id].context when refresh() is called
	* @param {Object} session The session to create the context for
	* @return {Object} A context object used to call the agent worker() function
	* @emits log Emitted as (session, ...args) whenever agent.log() is called
	* @emits warn Emitted as (session, ...args) whenever agent.warn() is called
	*/
	agents.createContext = session => {
		var context = {};

		// Basic logging {{{
		Object.assign(context, {
			log: (...msg) => agents.emit('log', session, ...msg),
			logThrottled: _.throttle((...msg) => context.log(...msg), agents.settings.logThrottle),
			warn: (...msg) => agents.emit('warn', session, ...msg),
		});

		context.log.colors = colors;
		context.log.flush = ()=> { /* FIXME: Not yet supported */ };
		// }}}

		// Progress reporting {{{
		Object.assign(context, {
			progressMax: undefined,
			progressCurrent: undefined,
			progressText: undefined,
			progress: argy('[string] number|string [number|string]', function(text, current, max) {
				if (text && !current && !max) { // Reset progress markers?
					context.progressText = text;
					context.progressCurrent = undefined;
					context.progressMax = undefined;
				} else {
					if (text !== undefined) context.progressText = text;
					if (current !== undefined) context.progressCurrent = _.toNumber(current);
					if (max !== undefined) context.progressMax = _.toNumber(max);
				}

				var output;

				this.progressCacheUpdate(); // Throttled progress write to cache (if we have a cache set)

				if (context.progressMax == 100) { // Already provided as a percentage
					context.logThrottled((context.progressText || 'Progress') + ':', Math.floor(context.progressCurrent) + '%');
				} else if (!_.isUndefined(context.progressCurrent) && !_.isUndefined(context.progressMax)) { // Provided some ranged number
					context.logThrottled((context.progressText || 'Progress') + ':', context.progressCurrent, '/', context.progressMax, '(' + Math.ceil(context.progressCurrent / context.progressMax * 100) + '%)');
				} else if (!_.isUndefined(context.progressCurrent)) { // Provided as some arbitrary number
					context.logThrottled((context.progressText || 'Progress') + ':', context.progressCurrent);
				} else if (!_.isUndefined(context.progressText)) { // Only have text
					context.log(context.progressText);
				}
			}),
			progressCacheUpdate: _.throttle(function(text, current, max) {
				if (!this.cache) return; // We don't have a cache accessibe - skip
				app.caches[this.cache].set(
					this.cacheKey + '-progress',
					{text: context.progressText, current: Math.ceil(context.progressCurrent / context.progressMax * 100)},
					Date.now() + 1000 * 60 * 30 // Clean up after 30m
				);
			}, agents.settings.logThrottle),
		});
		// }}}

		return context;
	};


	/**
	* Run the worker and cache the result
	* If this function is called while an existing cacheKey is already running the result will be that existing runner's promise return rather than creating a new instance
	*
	* If a session is requested the object returned is the same as that from createSession() but with additional fields: `status` ('pending', 'completed', 'error'), `result` (if resolved) and `error` (if rejected)
	*
	* WARNING: You almost always want the agents.get() function instead of agents.run()
	*          This function will ALWAYS run the agent, whereas get() provides a cached result if there is one
	*
	* @param {string} id The ID of the worker result to return
	* @param {string|Object} id The ID of the agent to run OR a session object from createSession()
	* @param {Object} [agentSettings] Optional settings to pass to the agent
	* @param {Object} [settings] Settings to change the behaviour of this function, see createSession() for the list of valid options
	* @param {string} [settings.want="promise"] What response to return. ENUM: "promise" (return a resovable promise which provides the result value), "session" (the created session rather than the promise itself)
	* @returns {Promise} Promise with result or thrown error
	* @emits run Called as `session` before a runner is passed the session to be run
	*/
	agents.run = (id, agentSettings = {}, settings = {}) =>
		Promise.resolve()
			.then(()=> _.isObject(id) ? id : agents.createSession(id, agentSettings, settings)) // Calculate a session or use the session given
			.then(session => {
				if (agents._running[session.cacheKey]) return agents._running[session.cacheKey].defer.promise; // If an agent is already running attach to its defer and complete

				// Exit when runner isn't within supported methods.
				// FIXME: Simply throw when attempting to run with an unsupported runner?
				if (session.worker.methods.indexOf(session.runner) === -1) {
					if (!settings.want || settings.want == 'promise') { // Want promise
						return session.defer.reject;
					} else if (settings.want == 'session') {
						session.status = 'error';
						session.result = undefined;
						return session;
					} else {
						throw new Error(`Unknown want type: "${settings.want}"`);
					}
				}

				agents._running[session.cacheKey] = session;

				setTimeout(()=> { // Queue in next cycle so we can return the promise object for now
					Promise.resolve()
						.then(()=> agents.emit('run', session))
						.then(()=> agents.caches[session.cache].unset(`${session.cacheKey}-progress`)) // Reset progress marker
						.then(()=> agents.runners[session.runner].exec(session))
						.then(value => session.defer.resolve(value))
						// FIXME: Rejection message never makes it back to logs?
						.catch(session.defer.reject)
						.finally(()=> delete agents._running[session.cacheKey])
				});

				if (!settings.want || settings.want == 'promise') { // Want promise
					return session.defer.promise;
				} else if (settings.want == 'session') {
					session.status = 'pending';
					session.result = undefined;
					return session;
				} else {
					throw new Error(`Unknown want type: "${settings.want}"`);
				}
			})



	/**
	* Update a session by checking its progress
	* NOTE: Passing the full session object is much faster as its not necessary to guess the cache to use
	* @param {string|Object} session Either a session object or its cacheKey
	* @returns {Object} The mutated session
	*/
	agents.getSession = session => {
		var id = _.isString(session) ? session : session.cacheKey;
		var possibleCaches = _.isString(session) ? _.keys(agents.caches) : [session.cache];

		if (_.isString(session)) session = {}; // Create stub to populate later

		return Promise.all([
			// Scan to see if we have a value
			Promise.all(possibleCaches.map(cache => agents.caches[cache].get(id))),

			// Try to find the (optional) progress
			Promise.all(possibleCaches.map(cache => agents.caches[cache].get(id + '-progress'))),
		])
			.then(results => {
				// Find the index of the most likely cache
				var useCacheIndex = possibleCaches.findIndex((cache, i) =>
					typeof results[0][i] !== 'undefined' ||
					typeof results[1][i] !== 'undefined'
				);

				session.result = results[0][useCacheIndex];
				session.progress = results[1][useCacheIndex];

				// FIXME: "stopped" pm2 processes may misreport status
				if (agents._running[id]) {
					session.status = 'pending';
				// NOTE: Legacy; Not aware of anywhere setting `session.result.error`
				} else if (_.isObject(session.result) && _.isEqual(_.keys(session.result), ['error'])) {
					session.status = 'error';
					session.error = session.result.error;
				} else if (_.isObject(session.result)) {
					session.status = 'complete';
				} else {
					session.status = 'error';
				}
			})
			.then(()=> session)
	};


	/**
	* Clear the cache contents for a given agent
	* @param {string|Object} id Either the ID of the agent contents to clear or the session object
	* @param {Object} [agentSettings] If ID is an agent ID settings is any additional optional settings to pass to the session creator
	* @param {Object} [settings] Additional settings when creating the session
	*/
	agents.invalidate = (id, agentSettings, settings) =>
		Promise.resolve()
			.then(()=> _.isObject(id) ? id : agents.createSession(id, agentSettings, settings))
			.then(session => agents.caches[session.cache].unset(session.cacheKey))


	/**
	* Retrieve a list of all agents with meta information
	* NOTE: The agent ID's returned are stipped of the prefix / suffixs added by the caching module
	* @returns {Promise} A promise which will resolve with the list data
	*/
	agents.list = ()=>
		Promise.resolve()
			.then(()=> Promise.all(_.keys(agents.caches).map(cache =>
				agents.caches[cache].list()
			)))
			.then(cacheContents => _.flatten(cacheContents))
			.then(cacheContents => {

				return _.map(agents._agents, agent => {
					var cacheKey = agents.getKey(agent.id);
					var res = {
						id: agent.id,
						cacheKey,
						timing: agent.timing,
						hasReturn: agent.hasReturn,
						show: agent.show,
						methods: agent.methods,
						expiresString: agent.expires || false,
						expires: _.isString(agent.expires) && agent.expires ? timestring(agent.expires) * 1000 : false,
					};

					if (res.timing) res.timingString = cronTranslate(res.timing);

					var matchingCache = cacheContents.find(cc => cc.id == cacheKey);
					if (matchingCache) _.assign(res, _.omit(matchingCache, 'id'));
					return res;
				});
			})

	if (agents.settings.autoInit) agents.init();

	return eventer.extend(agents);
};

module.exports = Agents;
