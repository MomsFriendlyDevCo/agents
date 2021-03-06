var Agents = require('..');
var mlog = require('mocha-logger');

var agents = new Agents({
	autoInstall: false,
});

before('Init agent instance', (done) => {
	agents.init()
		.then(() => done());
});

before('Setup emitter handlers', ()=> {
	agents
		.on('init', ()=> mlog.log('Created agents interface'))
		.on('ready', ()=> mlog.log('Agents interface ready'))
		.on('destroy', ()=> mlog.log('Destroying agents interface'))
		.on('destroyed', ()=> mlog.log('Destroyed agents interface'))
		.on('refreshWarn', (path, msg) => mlog.log('WARNING', path, msg))
		.on('refresh', ids => mlog.log('Loaded agents:', ids.join(', ')))
		.on('tick', id => mlog.log('Refreshing agent', id, 'from cron timing', agents._agents[id].timing))
		.on('scheduled', id => mlog.log('Installed agent', id, 'with timing', agents._agents[id].timing))
		.on('runImmediate', id => mlog.log('Agent', id, 'marked for immediate run!'))
		.on('log', (session, ...args) => mlog.log(...args))
		.on('warn', (session, ...args) => mlog.log('Warning', ...args));
});

after(()=> agents.destroy());

module.exports = agents;
