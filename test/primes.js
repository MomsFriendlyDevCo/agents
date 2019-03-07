var expect = require('chai').expect;
var mlog = require('mocha-logger');


describe('Calculate prime numbers an agent', function() {
	var agents = require('./setup');
	this.timeout(30 * 1000);

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
