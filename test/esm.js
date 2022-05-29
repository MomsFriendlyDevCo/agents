var Agents = require('..');
var expect = require('chai').expect;
var mlog = require('mocha-logger');
var inclusion = require('inclusion');

var agents = new Agents({
	autoInstall: false,
	require: path => inclusion(path)
		.then(mod => mod.default || mod), // use `default` as Agent object or the entire export structure
	paths: [
		`${__dirname}/../examples/*.mjs`,
	],
});

describe('Calculate prime numbers an ESM agent', function() {
	this.timeout(30 * 1000);

	before('Init agent instance as ES6', done => {
		agents.init()
			.then(()=> done())
	})


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


	it('should calculate prime numbers inline (ES6)', ()=>
		agents.run('primes', {limit: 1000}, {runner: 'inline'})
			.then(value => {
				expect(value).to.be.an('array');
				expect(value).to.have.length(168);
			})
	);

});
