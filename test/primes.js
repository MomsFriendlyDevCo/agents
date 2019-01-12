var Agents = require('..');
var expect = require('chai').expect;
var mlog = require('mocha-logger');

describe('Calculate prime numbers an agent', function() {
	this.timeout(30 * 1000);

	var agents;
	before('Setup the agent instance', ()=> {
		agents = new Agents({autoInit: false});
		return agents.init();
	});

	before('Setup emitter handlers', ()=> {
		agents
			.on('init', ()=> mlog.log('Created agents interface'))
			.on('ready', ()=> mlog.log('Agents interface ready'))
			.on('destroy', ()=> mlog.log('Destroying agents interface'))
			.on('destroyed', ()=> mlog.log('Destroyed agents interface'))
			.on('refreshWarn', (path, msg) => mlog.log('WARNING', path, msg))
			.on('refresh', ids => mlog.log('Loaded agents:', ids.join(', ')))
			.on('tick', id => mlog.log('Refreshing agent', id, 'from cron timing', agents.agents[id].timing))
			.on('scheduled', id => mlog.log('Installed agent', id, 'with timing', agents.agents[id].timing))
			.on('runImmediate', id => mlog.log('Agent', id, 'marked for immediate run!'))
	});

	after(()=> agents.destroy());

	it('should calculate prime numbers inline', ()=>
		agents.run('primes', {limit: 1000}, {runner: 'inline'})
			.then(result => {
				expect(result).to.be.an('array');
				expect(result).to.have.length(168);
			})
	);

	it.only('should calculate prime numbers using PM2', ()=>
		agents.run('primes', {limit: 1000}, {runner: 'pm2'})
			.then(result => {
				expect(result).to.be.an('array');
				expect(result).to.have.length(168);
			})
	);
});
