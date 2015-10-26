var async = require('async');

class Compare {
  var mysqlOrigin,
    mysqlDestination;


  function constructor(mysqlOrigin, mysqlDestination) {
    if (typeof mysqlOrigin == 'Object') {
      throw 'object expected for mysqlOrigin';
    }

    if (typeof mysqlDestination == 'Object') {
      throw 'object expected for mysqlDestination';
    }

    this.mysqlDestination = mysqlDestination;
    this.mysqlOrigin = mysqlOrigin;
  }
}


module.export(Compare);