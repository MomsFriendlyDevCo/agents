@momsfriendlydevco/agents
=========================
Deferred async job scheduler and runner for local or remote batch queues.


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
	.on('log', (...args) => console.log.apply(this, args))
	.on('warn', (...args) => console.log.apply(this, ['WARN'].concat(args)))
```
