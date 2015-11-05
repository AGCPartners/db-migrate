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
function MysqlTransit(dbOriginal, dbTemp, connectionParameters) {
  this.dbOriginal = dbOriginal;
  this.dbTemp = dbTemp;
  this.connectionParameters = connectionParameters;
  this.queryQueue = [];
  return this._init();
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
      if (err) throw err;

      return self;
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
      function switchDB(callback) {
        self.connection.query(util.format(queries.SWITCH_DB, self.dbOriginal), function(err) {
          if (err) callback(err);

          callback();
        });
      },
      function compareTables(callback) {
        self.connection.query(util.format(queries.COMPARE_TABLES, self.dbTemp, self.dbTemp, self.dbOriginal),
          function(err, results) {
            if (err) callback(err);

            var tablesToDrop = [];
            var tablesToCreate = [];

            results.forEach(function(t) {
              if(t.action === 'DROP') {
                tablesToDrop.push(t.table_name);
              } else {
                tablesToCreate.push(t.table_name);
              }
            });
            var verifyTables = tablesToDrop.map(function(t) {
              return function(cb) {
                var possibleAnswers = tablesToCreate.map(function(tbl, i) {
                  return {
                    name: 'Renamed to '+tbl,
                    value: i+2
                  };
                });

                possibleAnswers.unshift(
                  {
                    name: 'Removed',
                    value: 0
                  },
                  {
                    name: 'Skipped',
                    value: 1
                  }
                );

                inq.prompt([
                  {
                    name: 'verify',
                    message: 'Table ' + t + ' should be',
                    type: 'list',
                    choices: possibleAnswers
                  }
                ], function(answer) {
                  answer = parseInt(answer.verify);
                  switch(answer) {
                    case 0: {
                      self.connection.query(util.format(queries.DROP_TABLE, t), function(err) {
                        if (err) return cb(err);

                        console.log('Table ' + t + ' removed successfully.');
                        cb();
                      });
                      break;
                    }
                    case 1: {
                      cb();
                      break;
                    }
                    default: {
                      var index = parseInt(answer)-2;
                      self.connection.query(util.format(queries.RENAME_TABLE, t, tablesToCreate[index]), function(err) {
                        if (err) return cb(err);

                        tablesToCreate.splice(index, 1);
                        cb();
                      });
                      break;
                    }
                  }
                });
              };
            });

            async.series(verifyTables, function(err, results) {
              if (err) callback(err);

              var createTables = tablesToCreate.map(function(tbl) {
                return function(cb) {
                  inq.prompt([
                    {
                      name: 'create',
                      message: 'Create table ' + tbl + '?',
                      type: 'confirm',
                      default: true
                    }
                  ], function(answer) {
                    if(answer.create) {
                      self.connection.query(util.format(queries.CREATE_TABLE, self.dbOriginal, tbl, self.dbTemp, tbl), function(err) {
                        if (err) return cb(err);

                        console.log('Table ' + tbl + ' created successfully.');
                        cb();
                      });
                    } else {
                      console.log('Skipped');
                      cb();
                    }
                  });
                }
              });

              async.series(createTables, function(err, results) {
                if (err) callback(err);

                callback();
              });
            });
          }
        );
      },
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
                      name: 'Removed',
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
                          singleTableQueries.push(util.format(queries.DROP_COLUMN, table, rmField.name));
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

              console.log('Done.');
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