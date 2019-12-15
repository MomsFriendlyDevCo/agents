var expect = require('chai').expect;
var mlog = require('mocha-logger');

describe('Catching errors from within an agent', function() {
	var agents = require('./setup');
	this.timeout(30 * 1000);

	describe('Runner: inline', function() {
		it('should return an error when thrown', ()=>
			agents.run('errors', {throw: true}, {runner: 'inline'})
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);

		it('should return an error when passed to finish', ()=>
			agents.run('errors', {finish: true}, {runner: 'inline'})
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);
	});

	describe('Runner: pm2', function() {
		it('should return an error when thrown', ()=>
			agents.run('errors', {throw: true}, {runner: 'pm2'})
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);

		it('should return an error when passed to finish', ()=>
			agents.run('errors', {finish: true}, {runner: 'pm2'})
				.catch(e => {
					expect(e).to.be.a('string');
				})
		);
	});
});
