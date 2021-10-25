/**
* Example agent to demonstrate generating prime numbers (to a optional limit)
*
* @param {Object} [settings] Settings to use when calculating
* @param {number} [settings.delay=10] The number of milliseonds to wait between each number scan
* @param {number} [settings.limit=1000] The highest number to calculate to
*
* @example Retrieve an array of prime numbers
* agents.get('primes.test', {limit: 10000}).then(result => { ... })
*/
var _ = require('lodash');

module.exports = {
	id: 'primes',
	hasReturn: true,
	methods: ['aws', 'pm2', 'inline'],
	expires: '1h',
	worker: function(finish, settings) {
		var agent = this;
		_.defaults(settings, {
			delay: 0,
			limit: 10000,
		});

		settings.limit = parseInt(settings.limit);

		var isPrime = number => {
			let start = 2;
			const limit = Math.sqrt(number);
			while (start <= limit) {
				if (number % start++ < 1) return false;
			}
			return number > 1;
		};

		var scanNumber = 0;
		var results = [];
		var primeWorker = ()=> {
			if (++scanNumber > settings.limit) return finish(null, results);
			agent.progress(scanNumber, settings.limit);
			if (isPrime(scanNumber)) results.push(scanNumber);
			setTimeout(primeWorker, settings.delay);
		};

		primeWorker();
	},
};
