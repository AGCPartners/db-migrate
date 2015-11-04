var async = require('async');
var mysql = require('mysql');
var util = require('util');
var prompt = require('prompt');

/**
 * Initialize the MysqlTransit object
 *
 * @param dbOriginal name of the database to migrate
 * @param dbTemp name of the database to be migrated
 * @param connectionParameters object with
 * {
 *    port: mysqlParams.options.port,
 *    host: mysqlParams.options.host,
 *    user: mysqlParams.user,
 *    password: mysqlParams.password
 * }
 */
function MysqlTransit(dbOriginal, dbTemp, connectionParameters, next) {
  this.dbOriginal = dbOriginal;
  this.dbTemp = dbTemp;
  this.connectionParameters = connectionParameters;
  this.queryQueue = [];
  return this._init(next);
}

MysqlTransit.prototype._init = function(next) {
  var self = this;
  async.waterfall([
      function createMysqlConnection(callback) {
        self.connection = mysql.createConnection(self.connectionParameters);

        self.connection.connect(function(err) {
          if (err) {
            callback(err);
          }

          return callback(null, self.connection);
        });
      }
    ],
    function(err, result) {
      if (err) return next(err);

      return next(null, result);
    }
  );
}

/**
 * start the transit
 *
 * @param opt object with the configuration for the export
 * {
 *  interactive: false|true  // default true, if false execute the migrations without asking confirmation to the user
 * }
 * @param next
 */
MysqlTransit.prototype.transit = function(opt, next) {
  var self = this;
  var interactive = true;

  if (opt.hasOwnProperty('interactive') && opt.interactive === false) {
    interactive = false;
  }

  async.waterfall([
      function getAllTablesInTempDatabase(callback) {
        self.connection.query(util.format('SHOW TABLES IN `%s`', self.dbTemp), function(err, tables) {
          if (err) return callback(err);

          self.arrTable = tables.map(function(t) {
            return t['Tables_in_' + self.dbTemp];
          });
          return callback();
        });
      },
      function generateSQLMigration(callback) {
        var compareQueryTemplate = "" +
          "SELECT action,column_name,ordinal_position,data_type,column_type " +
          "FROM (SELECT column_name,ordinal_position,data_type,column_type,COUNT(1) " +
          "as rowcount, IF(table_schema='%s', 'ADD', 'DROP') as action FROM information_schema.columns " +
          "WHERE (table_schema='%s' OR table_schema='%s') AND table_name ='%s' " +
          "GROUP BY column_name,data_type,column_type,table_name " +
          "HAVING COUNT(1)=1) A;";
        var alterQueryTemplate = "ALTER TABLE %s %s COLUMN %s%s";

        self.compareQueries = self.arrTable.map(function(table) {
          return function(callback) {
            self.connection.query(util.format(compareQueryTemplate, self.dbTemp, self.dbTemp, self.dbOriginal, table),
              function(err, results) {
                if (err) callback(err);

                results.forEach(function(res) {
                  self.queryQueue.push(function(cb) {
                    var q = util.format(
                      alterQueryTemplate, table, res.action, res.column_name,
                      res.action === 'ADD' ? " " + res.column_type : ""
                    );

                    if (interactive) {
                      prompt.start();
                      prompt.message = "";
                      prompt.get({
                        properties: {
                          exec: {
                            description: 'Query: ' + q.green + ' Execute? (yes/no)',
                            default: 'yes',
                            pattern: /^(yes|no)/i
                          }
                        }
                      }, function(err, answer) {
                        if (err) return cb(err);
                        if (answer.exec.toLowerCase() === 'no') return cb();
                        if (answer.exec.toLowerCase() === 'yes') {
                          executeQuery(self.connection, q, function(err){
                            if (err) return cb(err);

                            return cb();
                          })
                        }
                      });
                    } else {
                      executeQuery(self.connection, q, function(err){
                        if (err) return cb(err);

                        return cb();
                      })
                    }
                  });
                });
                callback();
              });
          };
        });
        return callback();
      },
      function run(callback) {
        var switchDBQueryTemplate = "USE `%s`;";
        async.parallel(self.compareQueries, function(err, results) {
          if (err) callback(err);

          // here we switch to the original db
          self.connection.query(util.format(switchDBQueryTemplate, self.dbOriginal), function() {
            if (err) callback(err);

            // here we execute migration queries one by one
            async.series(self.queryQueue, function(err, result) {
              if (err) callback(err);

              return callback();
            });
          });
        });
      }
    ],
    // main callback
    function(err, result) {
      if (err) return next(err);

      return next();
    });
}

module.exports = MysqlTransit;

function executeQuery(connection, q, cb) {
  connection.query(q, function(err, res) {
    if (err) return cb(err);

    console.log('Query executed successfully');
    return cb();
  });
}