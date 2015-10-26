var async = require('async');

class MysqlTransit {

  function construct(mysqlOrigin, mysqlDestination, next) {
    async.waterfall([
        createDatabaseConnection(),
        dropMigrationDatabase()
      ],
      function(err, result) {
        return next();
      });
  }
}