var async = require('async');
var Compare = require('./lib/compare.js');
var Execute = require('./lib/execute.js');

function MysqlTransit(mysqlOrigin, mysqlDestination, next) {
  var compare = new Compare(mysqlOrigin, mysqlDestination);
  var execute = new Execute();
  async.waterfall([
      createMysqlConnection(),
      compare.getAllTablesInTempDatabase(),
      compare.generateSQLMigration(),
      execute.runMigration(),
    ],
    function(err, result) {
      return next();
    });
}

module.exports = MysqlTransit;