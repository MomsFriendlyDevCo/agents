var expect = require('chai').expect;
var mlog = require('mocha-logger');

var agents = require('./setup');
describe('Calculate prime numbers an agent', function() {
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

	it('should queue up the prime agent and wait for the session to complete via paging', ()=>
		agents.run('primes', {limit: 10000}, {runner: 'pm2', want: 'session'})
			.then(session => {
				expect(session).to.have.property('cacheKey');
				expect(session).to.have.property('status', 'pending');
				return session;
			})
			.then(session => new Promise((resolve, reject) => {
				var checkStatusCount = 0;
				var checkStatus = ()=> {
					mlog.log(`Check status #${++checkStatusCount}`);
					agents.getSession(session)
						.then(session => {
							if (session.status == 'complete') {
								resolve(session);
							} else if (session.status == 'error') {
								reject(session.error);
							} else {
								setTimeout(checkStatus, 1000);
							}
						});
				};
				checkStatus();
			}))
			.then(session => {
				expect(session.result).to.be.an('array');
				expect(session.result).to.have.length(1229);
			})
	);
});
