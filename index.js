var async = require('async');
var mysql = require('mysql');
var util = require('util');
var fs = require('fs');
var inq = require('inquirer');
var path = require('path');
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
  this.tablesToDrop = [];
  this.tablesToCreate = [];
  this.interactive = true;
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

MysqlTransit.prototype.executeQuery = function(q, cb) {
  var self = this;
  this.connection.query(q, function(err, res) {
    if (err) return cb(err);

    if (self.interactive === true) {
      console.log('--------------------------------------------------------------------------------');
      console.log(q);
      console.log('Query executed successfully');
      console.log('--------------------------------------------------------------------------------');
    }
    return cb();
  });
}

MysqlTransit.prototype.verifyTables = function() {
  var self = this;
  var verifyTables = self.tablesToDrop.map(function(t) {
    return function(cb) {
      var possibleAnswers = self.tablesToCreate.map(function(tbl, i) {
        return {
          name: 'Renamed to ' + tbl,
          value: i + 2
        };
      });

      if (self.interactive === true) {
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
          switch (answer) {
            case 0:
            {
              self.executeQuery(util.format(queries.DROP_TABLE, t), function(err) {
                if (err) return cb(err);

                if (self.interactive === true) {
                  console.log('Table ' + t + ' removed successfully.');
                }
                cb();
              });

              break;
            }
            case 1:
            {
              cb();
              break;
            }
            default:
            {
              var index = parseInt(answer) - 2;
              self.executeQuery(util.format(queries.RENAME_TABLE, t, self.tablesToCreate[index]), function(err) {
                if (err) return cb(err);

                self.tablesToCreate.splice(index, 1);
                cb();
              });
              break;
            }
          }
        });
      } else {
        cb();
      }
    };
  });
  return verifyTables;
}

MysqlTransit.prototype.createTables = function() {
  var self = this;
  var createTables = this.tablesToCreate.map(function(tbl) {
    return function(cb) {
      if (self.interactive === true) {
        inq.prompt([
          {
            name: 'create',
            message: 'Create table ' + tbl + '?',
            type: 'confirm',
            default: true
          }
        ], function(answer) {
          if (answer.create) {
            self.executeQuery(util.format(queries.CREATE_TABLE, self.dbOriginal, tbl, self.dbTemp, tbl), function(err) {
              if (err) return cb(err);

              if (self.interactive === true) {
                console.log('Table ' + tbl + ' created successfully.');
              }
              cb();
            });
          } else {
            if (self.interactive === true) {
              console.log('Skipped');
            }
            cb();
          }
        });
      } else {
        self.executeQuery(util.format(queries.CREATE_TABLE, self.dbOriginal, tbl, self.dbTemp, tbl), function(err) {
          if (err) return cb(err);

          if (self.interactive === true) {
            console.log('Table ' + tbl + ' created successfully.');
          }
          cb();
        });
      }
    }
  });
  return createTables;
}

/**
 * start the transit
 *
 * @param opt object with the configuration for the export
 * {
 *  interactive: false|true  // default true, if false execute the migrations without asking confirmation to the user,
 *  safe: false|true  // default false, if true it doesn't run the queries but write them in a file
 * }
 * @param next
 */
MysqlTransit.prototype.transit = function(opt, next) {
  var self = this;

  if (opt.hasOwnProperty('interactive') && opt.interactive === false) {
    this.interactive = false;
  }

  if (opt.hasOwnProperty('safe') && opt.safe === true) {
    this.safe = true;
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

            results.forEach(function(t) {
              if (t.action === 'DROP') {
                self.tablesToDrop.push(t.table_name);
              } else {
                self.tablesToCreate.push(t.table_name);
              }
            });

            async.series(self.verifyTables(), function(err, results) {
              if (err) callback(err);

              async.series(self.createTables(), function(err, results) {
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
            self.connection.query(util.format(queries.COMPARE_COLUMNS, self.dbTemp, self.dbTemp, self.dbOriginal, table, self.dbTemp, self.dbOriginal),
              function(err, results) {
                if (err) callback(err);

                var singleTableQueries = [];
                var removedFields = [];
                var addedFields = [];
                var modifiedFields = [];

                results.forEach(function(res) {
                  if (res.action === 'ADD') {
                    addedFields.push({ name: res.column_name, type: res.column_type });
                  } else if (res.action === 'DROP') {
                    removedFields.push({ name: res.column_name, type: res.column_type });
                  } else if (res.action === 'MODIFY') {
                    modifiedFields.push({ name: res.column_name, type: res.column_type });
                  }
                });

                // console.log(self.addedFields);

                var verify = removedFields.map(function(rmField) {
                  return function(cb) {
                    if (self.interactive === true) {
                      var possibleAnswers = addedFields.map(function(f, i) {
                        return {
                          name: 'Changed to ' + f.name + ' ' + f.type,
                          value: i + 2
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
                          message: 'In ' + table + ' table the field `' + rmField.name + '` should be:',
                          choices: possibleAnswers
                        }
                      ], function(answer) {
                        answer = parseInt(answer.verify);
                        switch (answer) {
                          case 0:
                          {
                            singleTableQueries.push(util.format(queries.DROP_COLUMN, table, rmField.name));
                            cb();
                            break;
                          }
                          case 1:
                          {
                            cb();
                            break;
                          }
                          default:
                          {
                            var index = parseInt(answer) - 2;
                            var newField = addedFields[index].name + ' ' + addedFields[index].type;
                            singleTableQueries.push(util.format(queries.CHANGE_COLUMN, table, rmField.name, newField));
                            addedFields.splice(index, 1);
                            cb();
                            break;
                          }
                        }
                      });
                    } else {
                      cb();
                    }
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
                      if (self.interactive === true) {
                        inq.prompt([{
                          name: 'exec',
                          message: 'Query: ' + query + ' Execute?',
                          type: 'confirm',
                          default: true
                        }], function(answer) {
                          if (answer.exec) {
                            self.executeQuery(query, function(err) {
                              if (err) cb(err);

                              cb();
                            });
                          } else {
                            console.log('Skipped');
                            cb();
                          }
                        });
                      } else {
                        self.executeQuery(query, function(err) {
                          if (err) cb(err);

                          cb();
                        });
                      }
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

              if (self.interactive === true) {
                console.log('Done.');
              }
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

/**
  var appDir = path.dirname(require.main.filename);
  this.filepath = (this.filepath) ? this.filepath : appDir + '/migration_' + Date.now();
  fs.writeFile(filepath, q + "\r\n", function(err) {
    if (err) return cb(err);
    console.log("The file was saved!");
    return cb();
  });
 */
module.exports = MysqlTransit;