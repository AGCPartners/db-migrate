var async = require('async');
var mysql = require('mysql');
var util = require('util');
var inq = require('inquirer');
var queries = require('./lib/queries.js');

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
 * @param next
 */
MysqlTransit.prototype.transit = function(next) {
  var self = this;

  async.waterfall([
      function getAllTablesInTempDatabase(callback) {
        self.connection.query(util.format(queries.SHOW_TABLES, self.dbTemp), function(err, tables) {
          if (err) return callback(err);

          self.arrTable = tables.map(function(t) {
            return t['Tables_in_' + self.dbTemp];
          });
          return callback();
        });
      },
      function generateSQLMigration(callback) {
        self.compareQueries = self.arrTable.map(function(table) {
          return function(callback) {
            self.connection.query(util.format(queries.COMPARE_COLUMNS, self.dbTemp, self.dbTemp, self.dbOriginal, table),
              function(err, results) {
                if (err) callback(err);

                var singleTableQueries = [];
                var removedFields = [];
                var addedFields = [];
                var modifiedFields = [];

                results.forEach(function(res) {
                  if(res.action === 'ADD') {
                    addedFields.push({ name: res.column_name, type: res.column_type });
                  } else if(res.action === 'DROP') {
                    removedFields.push({ name: res.column_name, type: res.column_type });
                  } else if(res.action === 'MODIFY') {
                    modifiedFields.push({ name: res.column_name, type: res.column_type });
                  }
                });

                // console.log(self.addedFields);

                var verify = removedFields.map(function(rmField) {
                  return function(cb) {
                    var possibleAnswers = addedFields.map(function(f, i) { 
                      return { 
                        name: 'Changed to ' + f.name + ' ' + f.type,
                        value: i+2
                      };
                    });
                    possibleAnswers.unshift({
                      name: 'Deleted',
                      value: 0
                    },
                    {
                      name: 'Skipped',
                      value: 1
                    });

                    inq.prompt([
                      {
                        name: 'verify',
                        type: 'list',
                        message: 'In '+table+' table the field `' +rmField.name+'` should be:',
                        choices: possibleAnswers
                      }
                    ], function(answer) {
                      answer = parseInt(answer.verify);
                      switch(answer) {
                        case 0: { 
                          singleTableQueries.push(util.format(queries.ALTER_TABLE, table, 'DROP', rmField.name, ""));
                          cb();
                          break;
                        }
                        case 1: {
                          cb();
                          break;
                        }
                        default: {
                          var index = parseInt(answer)-2;
                          var newField = addedFields[index].name + ' ' + addedFields[index].type;
                          singleTableQueries.push(util.format(queries.CHANGE_COLUMN, table, rmField.name, newField));
                          addedFields.splice(index, 1);
                          cb();
                          break;
                        }
                      }
                    });
                  }
                });

                async.series(verify, function(err, result) {
                  if (err) callback(err);

                  addedFields.forEach(function(newField) {
                    singleTableQueries.push(util.format(queries.ADD_COLUMN, table, newField.name, newField.type));
                  });

                  modifiedFields.forEach(function(modifiedField) {
                    singleTableQueries.push(util.format(queries.MODIFY_COLUMN, table, modifiedField.name, modifiedField.type))
                  });

                  singleTableQueries.forEach(function(query) {
                    self.queryQueue.push(function(cb) {
                      inq.prompt([{
                        name: 'exec',
                        message: 'Query: ' + query + ' Execute?',
                        type: 'confirm',
                        default: true
                      }], function(answer) {
                        if(answer.exec) {
                          self.connection.query(query, function(err, res) {
                            if (err) cb(err);

                            console.log('Query executed successfully');
                            cb();
                          });
                        } else {
                          console.log('Skipped');
                          cb();
                        }
                      });
                    });
                  });
                  callback();
                });
              });
          };
        });
        return callback();
      },
      function run(callback) {
        async.series(self.compareQueries, function(err, results) {
          if (err) callback(err);

          // here we switch to the original db
          self.connection.query(util.format(queries.SWITCH_DB, self.dbOriginal), function() {
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
