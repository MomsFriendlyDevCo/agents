var expect = require('chai').expect;
var mlog = require('mocha-logger');

describe('Logging', function() {
	var agents = require('./setup');
	this.timeout(30 * 1000);

	it('should successfully log null', ()=> {
		/*
		agents.on('log', (session, ...args) => {
			console.log('log handler', args);
		});
		*/
		return agents.run('logging', {}, {runner: 'pm2'})
		//expect(res).to.be.undefined;
	});
});
