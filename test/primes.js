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
			.on('log', (...args) => mlog.log(...args))
			.on('warn', (...args) => mlog.warn(...args))
	});

	after(()=> agents.destroy());

	it('should calculate prime numbers inline', ()=>
		agents.run('primes', {limit: 1000}, {runner: 'inline'})
			.then(value => {
				expect(value).to.be.an('array');
				expect(value).to.have.length(168);
			})
	);

	it('should calculate prime numbers using PM2', ()=>
		agents.run('primes', {limit: 1000}, {runner: 'pm2'})
			.then(value => {
				expect(value).to.be.an('array');
				expect(value).to.have.length(168);
			})
	);

	it('should queue up the prime agent and return the session', ()=>
		agents.run('primes', {limit: 1000}, {runner: 'pm2', want: 'session'})
			.then(result => {
				expect(result).to.be.an('object');
				expect(result).to.have.property('defer');
				expect(result).to.have.property('cacheKey');
				expect(result.cacheKey).to.be.a('string');

				return result.defer.promise;
			})
			.then(value => {
				expect(value).to.be.an('array');
				expect(value).to.have.length(168);
			})
	);
});
