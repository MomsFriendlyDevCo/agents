@momsfriendlydevco/agents
=========================
Deferred async job scheduler and runner for local or remote batch queues.

Features:

* Run background jobs periodically, as required or with use-cache-or-rerun methods
* Supports multiple runners
* Can be used in JavaScript as a module or from the command line as a runner
* Supports both CJS and ESM modules by default



```javascript
var Agents = require('@momsfriendlydevco/agents');

var agents = new Agents();

// Calculate the first 100 prime numbers within PM2 / AWS or some other runner
agents.get('primes', {limit: 100}) 
	.then(result => { ... }) // Do something with the result


// Set up a job to calculate the first million prime numbers
// This doesn't return the result but the session we can use to ask about its status
agents.get('primes', {limit: 1e6}, {want: 'session'}) 
	.then(session => {
		// Set up a function to page the session and ask if its done yet
		var checkSession = ()=> agents.getSession(session).then(session => {
			if (session.status == 'complete') {
				console.log('Yey there are', session.result.length, 'primes');
			} else {
				setTimeout(checkSession, 1000); // Check again in 1s
			}
		});
		checkSession(); // Kick off the initial check
	})
```

ESM / ES6 compatibility
-----------------------
This module is CJS and ESM compatible by default via the [Inclusion](https://github.com/davidmarkclements/inclusion) transpiler.

However if a newer require system is required, the `require` option can be overloaded to use a third party module to pre-compile ESM modules to CJS:

```javascript
var agents = new Agents({
	require: path => myCustomRequire(path)
		.then(mod => mod.default || mod), // Other cleanup methods when done
});
```


Adding agents to package.json
-----------------------------
Add the agent binary command to your package.json:

```json
{
  "name": "abi-ims",
  "version": "0.0.0",
  "description": "Inventory Management Sub-system for ABI",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "agents": "agents -l",
    "agents:mintProductsDelta": "agents myAgentToRun --command-line-options"
  },
  "agents": {
    "paths": [
      "./agents/*.js"
    ],
    "runner": {
      "modules": [
        "pm2",
        "inline"
      ]
    }
  }
}
```

The above maps `npm run agents` to listing the available agents within a project, `run run agents:mintProductsDelta` runs a specific agent with the specified command line.
The `agents` branch contains the various defaults the agent binary will use when executing such as the default paths to search and the runners to use.


Module API
==========

new Agents([settings])
----------------------
Create an agents instance and set its initial objects.

The following settings are supported (in dotted form):

| Setting                              | Type         | Default                        | Description                                                                                                                                               |
|--------------------------------------|--------------|--------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `autoInit`                           | `boolean`    | `false`                        | Whether constructing the object will also call `agents.init()` automatically. Use `agents.on('ready')` to trap when the agent has loaded                  |
| `autoInstall`                        | `boolean`    | `true`                         | Whether any timed jobs should be installed via Cron                                                                                                       |
| `allowImmediate`                     | `boolean`    | `true`                         | Allow any agents detected as `{immediate: true}` to execute                                                                                               |
| `checkProcess`                        | `number`     | `1000`                          | Interval between PM2 process status checks                                                                |
| `logThrottle`                        | `number`     | `250`                          | Delay between log output from `agent.logThrottle()` or `agent.progress()`                                                                |
| `paths`                              | `array`      | `['examples/**/*.agent.js']`   | Paths to search for agent files                                                                                                                           |
| `keyRewrite`                         | `function`   | `key => key`                   | How to mangle the allocated cacheKey when assigning agents                                                                                                |
| `cache`                              | `object`     | See below                      | The cache options. All settings except `cache.calculate` are specific to [@momsfriendlydevco/cache](https://github.com/MomsFriendlyDevCo/generic-cache)   |
| `cache.calculate`                    | `function`   | See notes                      | Function used to select the caching module to use                                                                                                         |
| `runner`                             | `object`     | See below                      | The runner options                                                                                                                                        |
| `runner.modules`                     | `array`      | `['inline']`                   | Supported runner modules                                                                                                                                  |
| `runner.calculate`                   | `function`   | `session => 'inline'`          | How to select the applicable runner                                                                                                                       |
| `runner.pm2`                         | `object`     | See below                      | Various configuration options for PM2                                                                                                                     |
| `runner.pm2.procName`                | `function`   | `cacheKey => cacheKey`         | The name of the PM2 process, calculated from the cacheKey                                                                                                 |
| `runner.pm2.execFile`                | `string`     | `${__dirname}/agents.js`       | The code Node `agents.js` file used to execute the inline process                                                                                         |
| `runner.pm2.execFileInterpreter`     | `string`     | `"node"`                       | The interpreter to set for the `agents.js` file                                                                                                           |
| `runner.pm2.execFileInterpreterArgs` | `array`      | See code                       | Arguments passed to the interpreter of `agents.js`                                                                                                        |
| `runner.pm2.cwd`                     | `string`     | `${__dirname}`                 | The working directory of the `agents.js` file                                                                                                             |
| `runner.pm2.env`                     | `function`   | See code                       | The environment to pass to the `agents.js` file                                                                                                           |
| `runner.pm2.logFileScan`             | `boolean`    | `true`                         | Examine the main pm2 log file to determine additional detail if PM2 claims a process exited correctly |
| `runner.pm2.logFilePath`             | `boolean`    | `$HOME/.pm2/pm2.log`           | Log file to examine for process exit information |
| `runner.pm2.logFileTailSize`         | `number`     | `2048`                         | How many bytes backwards from the end of the main PM2 log file to read |
| `agentDefaults`                      | `object`     | See code                       | Options set as defaults when reading in each agent file                                                                                                   |



**Notes:**

* The cache used is [@momsfriendlydevco/cache](https://github.com/MomsFriendlyDevCo/generic-cache) the all of the `cache` settings excepting `calculate` are passed to it to initialize the caches
* The default `cache.calculate` code simply selects the first module specified in `cache.modules`





agents.init([settings])
-----------------------
Initialize the agent manager, including starting all runners and caches.
Returns a promise.


agents.settings
---------------
The storage object for the agents settings, use `agents.set()` to populate this conveniently.
See the main constructor for a list of settings.


agents.set(key, [val])
----------------------
Set a single key (dotted or array notation is supported) or merge an entire object into `agents.settings`
Returns the `agents` chainable object.


agents.refresh()
----------------
Function which refreshes available agents, this is automatically called by `agents.init()`.
Returns a promise.


agents.has(id)
--------------
Asks if the supplied agent ID is valid.
Returns a boolean.


agents.destroy()
----------------
Asks the agents object to clean up all caches, runners and any other async objects.
Returns a promise.


agents.get(id, [agentSettings], [settings])
-------------------------------------------
Either returns a cached agent value or, if none are found, calls `agents.run()` automatically to obtain one.
Returns a promise.


agents.getSize(id, [agentSettings], [settings])
-----------------------------------------------
Returns the *size* of a cached response or `undefined` if none is found.
Returns a promise.


agents.run(id, [agentSettings], [settings])
-------------------------------------------
This is the main function which runs an agent and waits for its response.
Returns a promise.


agents.invalidate(id, [agentSettings], [settings])
--------------------------------------------------
Invalidates an agent response - that is, this function will remove the cached value. This causes subsequent calls to `agents.get()` to recalculate.
Returns a promise.


agents.list()
-------------
Returns a list of all available agents, their cache status and other meta information.
Returns a promise.


Agent API
=========
The following is a minimal example of an agent file:

```javascript
module.exports = {
	id: 'myAgent',
	hasReturn: true,
	immediate: false,
	methods: ['pm2', 'inline'],
	triggers: ['build'],
	expires: '1h',
	worker: function() {
		var agent = this;
		// ... Agent work here ... //
	},
};
```

See the [examples](./examples) directory for more comprehensive examples.


Agents have the following settings:

| Setting        | Type                 | Default             | Description                                                                                                 |
|----------------|----------------------|---------------------|-------------------------------------------------------------------------------------------------------------|
| `id`           | `string`             |                     | The unique ID identifying the agent                                                                         |
| `worker`       | `function`           |                     | Worker function to call as `(callback, settings)`                                                           |
| `clearOnBuild` | `boolean`            | `false`             | Whether the agent cache should be invalidated on any system build                                           |
| `expires`      | `boolean` / `string` | `false`             | Additional cache expiry options to hold the agent response                                                  |
| `hasReturn`    | `boolean`            | `true`              | Whether the agent is expected to return a value, an warning occurs if the agent does not                    |
| `immediate`    | `boolean`            | `false`             | Indicates that the agent should always be executed when the agent module loads the agent for the first time |
| `methods`      | `array<string>`      | `['inline', 'pm2']` | Method types this agent is compatible with                                                                  |
| `path`         | `string`             | Calculated          | Calculate as the source agent path when refreshing                                                          |
| `show`         | `boolean`            | `true`              | Whether to show the agent in the agent list                                                                 |
| `triggers`     | `triggers`           | `[]`                | Additional triggers that make the agent run. Examples could include things like `"boot"`, `"build"` etc.    |




**Notes**:
* All defaults are configurable in `agents.settings.agentDefaults`


When executed all agent functions are given a context which has access to the following convenience API methods:

agent.log(...msg)
-----------------
Output generic information. This is the same functionality as `console.log()` but can be captured by the upstream agent invoker.


agent.logThrottled(...msg)
--------------------------
Functionally the same as `agent.log()` but this function is designed to deal with blast data by throttling the actual output.


agent.log.flush()
-----------------
Manually release any throttled log content.


agent.warn(...msg)
------------------
Output a warning. This is the same functionality as `console.warn()` but can be captured by the upstream agent invoker.


agent.log.colors
----------------
Convenience object which provides a [Chalk](https://github.com/chalk/chalk) instance.


agent.progress([title], currentProgress, [maxProgress])
-------------------------------------------------------
Output a progress indicator using `agent.logThrottled()`. Upstream agent invokers have access to this output and could present a progress bar of some kind.


Tips
====

Recommended emitter bindings
----------------------------

```javascript
var prefix = colors.blue('[agents]');

agents
	.on('init', ()=> console.log(prefix, 'Created agents interface'))
	.on('ready', ()=> console.log(prefix, 'Agents interface ready'))
	.on('destroy', ()=> console.log(prefix, 'Destroying agents interface'))
	.on('destroyed', ()=> console.log(prefix, 'Destroyed agents interface'))
	.on('refreshWarn', (path, msg) => console.log(prefix, colors.yellow('WARNING'), colors.cyan(path), msg))
	.on('refresh', ids => console.log(prefix, 'Loaded agents:', ids.map(i => colors.cyan(i)).join(', ')))
	.on('tick', id => console.log(prefix, 'Refreshing agent', colors.cyan(id), 'from cron timing', colors.cyan(agents.agents[id].timing)))
	.on('scheduled', id => console.log(prefix, 'Installed agent', colors.cyan(id), 'with timing', colors.cyan(agents.agents[id].timing)))
	.on('runImmediate', id => console.log(prefix, 'Agent', colors.cyan(id), 'marked for immediate run!'))
	.on('log', (session, ...args) => console.log.apply(this, args))
	.on('warn', (session, ...args) => console.log.apply(this, ['WARN'].concat(args)))
```
