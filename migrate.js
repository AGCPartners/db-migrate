var Sails = require('sails').Sails;
var mysql = require('mysql');
var util = require('util');
var connectionsConfig = require('../../config/connections');
var modelsConfig = require('../../config/models');
var async = require('async');
var prompt = require('prompt');
var colors = require('colors');

var dropTempDbQueryTemplate = 'DROP DATABASE IF EXISTS `%s`;';
var createTempDbQueryTemplate = 'CREATE DATABASE IF NOT EXISTS `%s`;';
var compareQueryTemplate = "SELECT action,column_name,ordinal_position,data_type,column_type FROM (SELECT column_name,ordinal_position,data_type,column_type,COUNT(1) as rowcount, IF(table_schema='%s', 'ADD', 'DROP') as action FROM information_schema.columns WHERE (table_schema='%s' OR table_schema='%s') AND table_name ='%s' GROUP BY column_name,data_type,column_type,table_name HAVING COUNT(1)=1) A;";
var switchDBQueryTemplate = "USE `%s`;";
var alterQueryTemplate = "ALTER TABLE %s %s COLUMN %s%s";

module.exports = function(grunt) {
  grunt.registerTask('migrate', 'Migration tool', function() {
    var done = this.async();
    var env = grunt.option('env') || process.env.NODE_ENV;
    var envConfig = require('../../config/env/' + env + '.js');
    var envConnection =
      (envConfig.hasOwnProperty('models') && envConfig.models.hasOwnProperty('connection')) ?
        envConfig.models.connection : modelsConfig.models.connection;

    var mysqlParams = connectionsConfig.connections[envConnection];
    var mysqlConfig = {
      port: mysqlParams.options.port,
      host: mysqlParams.options.host,
      user: mysqlParams.user,
      password: mysqlParams.password
    };
    var queryQueue = [];

    var origDB = mysqlParams.database;
    var migrationDB = 'sailsMigration' + Math.floor(Math.random() * 999999);
    mysqlParams.database = migrationDB;
    mysqlParams.module = 'sails-mysql';
    var sailsConfig = {
      port: -1,
      log: { level: 'silent' },
      hooks: { blueprints: false, orm: false, pubsub: false },
      models: { migrate: 'drop', connection: 'migration' },
      connections: {
        migration: mysqlParams
      }
    };
    // console.log(sailsConfig);
    prompt.message = "SailsJS + Sequelize migration tool by AGC Partners Ltd. <developers@agcparners.co.uk>".cyan;
    prompt.delimiter = '\n';
    prompt.start();
    prompt.get({
      properties: {
        continue: {
          description: "You're about to alter your database. It is strongly advised to create a backup before you proceed. Ready to go? (yes/no)".red,
          default: 'yes',
          pattern: /^(yes|no)$/i,
          required: true
        }
      }
    }, function (err, result) {
      //console.log(result.name.cyan);
      if(result.continue.toLowerCase() === 'no') done();

      var connection = mysql.createConnection(mysqlConfig);

      connection.connect(function(err) {
        if (err) done(err);
        var dropQuery = util.format(dropTempDbQueryTemplate, migrationDB);
        var dbQuery = util.format(createTempDbQueryTemplate, migrationDB);
        connection.query(dropQuery, function(err) {
          if (err) done(err);
          connection.query(dbQuery, function(err) {
            if(err) done(err);

            var sails = new Sails();
            sails.lift(sailsConfig, function (err, server) {
              // console.log(server.config);
              if (err) done(err);

              //console.log('Sails lifted');
              connection.query(util.format('SHOW TABLES IN `%s`', migrationDB), function(err, tables) {
                if(err) done(err);

                var tbl = tables.map(function(t) { return t['Tables_in_' + migrationDB]; });
                //console.log(tbl);

                var compareQueries = tbl.map(function(t) {
                  return function(callback) {
                    connection.query(util.format(compareQueryTemplate, migrationDB, migrationDB, origDB, t), function(err, results) {
                      if(err) callback(err);

                      results.forEach(function(res) {
                        queryQueue.push(function(cb) {
                          var q = util.format(alterQueryTemplate, t, res.action, res.column_name, res.action === 'ADD' ? " "+res.column_type:"");
                          prompt.start();
                          prompt.message = "";
                          prompt.get({
                            properties: {
                              exec: {
                                description: 'Query: '+q.green+' Execute? (yes/no)',
                                default: 'yes',
                                pattern: /^(yes|no)/i
                              }
                            }
                          }, function(err, answer) {
                            if (err) cb(err);
                            if(answer.exec.toLowerCase() === 'no') cb();
                            if(answer.exec.toLowerCase() === 'yes') {
                              connection.query(q, function(err, res) {
                                if(err) cb(err);

                                console.log('Query executed successfully');
                                cb();
                              });
                            }
                          });
                        });
                      });
                      callback();
                    });
                  };
                });

                async.parallel(compareQueries, function(err, results) {
                  if (err) done(err);

                  connection.query(util.format(switchDBQueryTemplate, origDB), function() {
                    if (err) done(err);

                    async.series(queryQueue, function(err, result) {
                      if (err) done(err);

                      connection.query(dropQuery, function(err) {
                        if (err) done(err);

                        done();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};
