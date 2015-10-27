var async = require('async');

function Compare() {
  if (typeof mysqlOrigin == 'Object') {
    throw 'object expected for mysqlOrigin';
  }

  if (typeof mysqlDestination == 'Object') {
    throw 'object expected for mysqlDestination';
  }

  this.mysqlDestination = mysqlDestination;
  this.mysqlOrigin = mysqlOrigin;
}

/**
 * query to get all the desired tables
 *
 * @return Array map the query result into an array
 */
Compare.prototype.getAllTablesInTempDatabase = function() {
  console.log(this.mysqlDestination);
}


module.exports = Compare;