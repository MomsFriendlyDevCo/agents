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
var cache = require('@momsfriendlydevco/cache');
var colors = require('chalk');
var crypto = require('crypto');
var CronJob = require('cron').CronJob;
var eventer = require('@momsfriendlydevco/eventer');
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

		cache: {
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
		},

		agentDefaults: {
			hasReturn: true,
			immediate: false,
			clearOnBuild: false,
			show: true,
			runners: ['pm2', 'inline'],
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
	* @param {array} [methods] Which methods are allowed to run the agent, these are processed in first->last priority order with the first matching being used
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
			.then(paths =>
				agents._agents = _(paths)
					.mapKeys(path => {
						var module = require(path);
						if (!module.id) agents.emit('refreshWarn', path, 'file does not have an ID or look like a valid agent - skipped');
						return module.id;
					})
					.mapValues(path => _.defaults(require(path), agents.settings.agentDefaults))
					.pickBy((v, k) => k !== 'undefined') // Only include agents that have a valid ID
					.value()
			)
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
				return Promise.all(_.values(agents.agents)
					.filter(agent => agent.immediate)
					.map(agent => {
						agents.emit('runImmediate', agent.id);
						agents.run(agent.id);
					})
				);
			})
			.then(()=> agents.emit('ready'))
			.then(()=> this)


	/**
	* Setup all cache storage
	*/
	agents.initCaches = ()=>
		Promise.resolve()
			.then(()=> agents.caches = {})
			.then(()=> Promise.all(agents.settings.cache.modules.map(id => new Promise((resolve, reject) => {
				agents.caches[id] = new cache({...agents.settings.cache, modules: [id]}, err => {
					if (err) { reject(err) } else { resolve() }
				});
			}))))


	/**
	* Setup all agent cron timings
	*/
	agents.initCron = ()=>
		Promise.all(
			_.values(agents.agents).map(agent => {
				if (!agent.timing || !agents.settings.autoInstall) return; // No timing - don't bother registering
				agent.cronJob = new CronJob({
					cronTime: agent.timing,
					onTick: ()=> {
						agents.emit('tick', id);
						agents.run(id);
					},
					start: true,
				});

				agents.emit('scheduled', id);
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
			.then(()=> agents.emit('destroy'))
			.then(()=> Promise.all([
				// Destroy all runners if they expose a 'destroy' function
				()=> Promise.all(_.values(this.runners).filter(r => _.isFunction(r.destroy)).map(r => r.destroy())),

				// Destroy all caches
				()=> Promise.all(_.values(this.caches).map(c => c.destroy())),
			]))
			.then(()=> agents.emit('destroyed'))
			.then(()=> agents = null)


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

		return _.isEmpty(hashable)
			? id
			: id + '-' +
				crypto.createHash('sha256')
					.update(_.isString(hashable) || _.isNumber(hashable) || _.isBoolean(hashable) ? hashable : JSON.stringify(hashable))
					.digest('hex')
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
			.then(()=> session = {
				agent: id,
				agentSettings,
				cacheKey: settings.cacheKey || agents.getKey(id, agentSettings),
				runner: 'not yet calculated',
				cache: 'not yet calculated',
				startTime: Date.now(),
				worker: agents._agents[id],
				settings: {...agents.settings, ...settings},
				defer: agents.createDefer(),
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
	* @returns {Promise} A promise which resolves with the agent result
	*/
	agents.get = (id, agentSettings = {}, settings = {}) =>
		Promise.resolve()
			.then(()=> _.isObject(id) ? id : agents.createSession(id, agentSettings, settings)) // Calculate a session or use the session given
			// Try to access an existing cache value - resolve this promise chain if we have one, otherwise call run()
			.then(session => new Promise((resolve, reject) => {
				agents.caches[session.cache].get(agentSettings.$cacheKey, (err, val) => {
					if (err) {
						reject(err);
					} else if (val !== undefined) {
						resolve(val);
					} else {
						resolve(agents.run(session));
					}
				});
			}))


	/**
	* Create an agent context for the running session
	* The context gets attached to agents._agents[id].context when refresh() is called
	* @param {Object} session The session to create the context for
	* @return {Object} A context object used to call the agent worker() function
	* @emits log Emitted as (...args) whenever agent.log() is called
	* @emits warn Emitted as (...args) whenever agent.warn() is called
	*/
	agents.createContext = session => {
		var context = {};

		// Basic logging {{{
		Object.assign(context, {
			log: (...msg) => agents.emit('log', ...msg),
			logThrottled: _.throttle((...msg) => context.log(...msg), agents.settings.logThrottle),
			warn: (...msg) => agents.emit('warn', ...msg),
		});

		context.log.colors = colors;
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

				agents._running[session.cacheKey] = session;

				setTimeout(()=> { // Queue in next cycle so we can return the promise object for now
					Promise.resolve()
						.then(()=> agents.emit('run', session))
						.then(()=> agents.caches[session.cache].unset(`${session.cacheKey}-progress`)) // Reset progress marker
						.then(()=> agents.runners[session.runner].exec(session))
						.then(value => session.defer.resolve(value))
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
					throw new Error(`Unkown want type: "${settings.want}"`);
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

		return Promise.all([
			// Scan to see if we have a value
			Promise.all(possibleCaches.map(cache => agents.caches[cache].get(id))),

			// Try to find the (optional) progress
			Promise.all(possibleCaches.map(cache => agents.caches[cache].get(id + '-progress'))),
		])
			.then(results => {
				// Find the index of the most likely cache
				var useCacheIndex = possibleCaches.findIndex((cache, i) => results[0][i] || results[1][i]);

				session.result = results[0][useCacheIndex];
				session.progress = results[1][useCacheIndex];

				if (_.isObject(session.result) && _.isEqual(_.keys(session.result), ['error'])) {
					session.status = 'error';
					session.error = session.result.error;
				} else {
					session.status = session.result ? 'complete' : 'pending';
				}
			})
			.then(()=> session)
	};


	// FIXME: Refactor line ------------------------------------------------------------------------------------------------------------------------------------------------


	/**
	* Clear the cache contents for a given agent
	*/
	agents.invalidate = argy('string [object] [function]', function(id, settings, finish) {
		// Sanity checks {{{
		if (!app.agents._agents[id]) throw new Error(`Agent "${id}" is invalid`);
		// }}}
		// Compute the cache key to use when communicating (if settings exists) {{{
		if (!settings) settings = {};
		var cacheKey = settings.$cacheKey || agents.getKey(id, settings);
		// }}}

		async()
			// Determine run method {{{
			.then('method', function(next) {
				if (app.config.agents.methods.force) return next(null, app.config.agents.methods.force);
				if (!agents._agents[id].methods) return next(`Agent "${id}" has no execution methods specified`);
				var method = agents._agents[id].methods.find(m => app.config.agents.methods[m]);
				if (!method) return next('Cannot find available method to execute agent');
				next(null, method);
			})
			// }}}
			// Determine cache method {{{
			.then('cache', function(next) {
				if (!_.get(app, 'config.agents.cache')) return next('No cache method rules defined in app.config.agents.cache');
				var cache = app.config.agents.cache
					.map(rule => // Transform functions into their results
						_.isFunction(rule) ? rule(Object.assign({}, agents._agents[id], {method: this.method}))
						: rule
					)
					.find(rule => rule) // First non-undefined

				if (!cache) return next('Cannot find any cache to use based on rules defined in app.config.agents.cache');
				if (!app.caches[cache]) return next(`Need to use caching method "${cache}" but it is not loaded in app.caches`);
				next(null, cache);
			})
			// }}}
			// Invalidate the cache {{{
			.then(function(next) {
				app.caches[this.cache].unset(cacheKey, next);
			})
			// }}}
			.end(finish);
	});


	/**
	* Retrieve a list of all agents with meta information
	* NOTE: The agent ID's returned are stipped of the prefix / suffixs added by the caching module
	* @param {function} finish Callback to call as (err, res)
	*/
	agents.list = argy('function', function(finish) {
		async()
			.parallel({
				agents: function(next) {
					next(null, agents._agents);
				},
				cacheContents: function(next) {
					async()
						.map('items', _.keys(app.caches), function(next, id) {
							app.caches[id].list(next);
						})
						.then('items', function(next) {
							next(null, _.flatten(this.items));
						})
						.end('items', next);
				},
			})
			.map('agents', 'agents', function(next, agent) {
				// Create basic return
				var cacheKey = app.config.middleware.cache.keyMangle(agent.id);
				var res = {
					id: agent.id,
					cacheKey: cacheKey,
					timing: agent.timing,
					hasReturn: agent.hasReturn,
					show: agent.show,
					methods: agent.methods,
					expiresString: agent.expires || false,
					expires: _.isString(agent.expires) && agent.expires ? timestring(agent.expires) * 1000 : false,
				};

				if (res.timing) res.timingString = cronTranslate(res.timing);

				var matchingCache = this.cacheContents.find(cc => cc.id == cacheKey);
				if (matchingCache) _.assign(res, _.omit(matchingCache, 'id'));

				next(null, res);
			})
			.end(function(err) {
				if (err) return finish(err);
				finish(null, _.values(this.agents));
			});
	});

	if (agents.settings.autoInit) agents.init();

	return eventer.extend(agents);
};

module.exports = Agents;
