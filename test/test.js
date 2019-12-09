var expect = require('chai').expect;
var mlog = require('mocha-logger');


describe('Query meta information', function() {
	var agents = require('./setup');
	this.timeout(30 * 1000);

	it('should get a list of available agents', ()=>
		agents.list()
			.then(result => {
				expect(result).to.be.an('array');
				expect(result).to.have.length(2);
				expect(result[0]).to.have.property('id', 'errors');
				expect(result[0]).to.have.property('cacheKey');
				expect(result[1]).to.have.property('id', 'primes');
				expect(result[1]).to.have.property('cacheKey');
			})
	)

	// TODO: `get`; should trigger agent
	// TODO: `get`; should return cached results

});
