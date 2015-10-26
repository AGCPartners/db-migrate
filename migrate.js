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
    // get the env from the params or use the NODE_ENV
    var env = grunt.option('env') || process.env.NODE_ENV;
    var envConfig = require('../../config/env/' + env + '.js');
    var envConnection =
      (envConfig.hasOwnProperty('models') && envConfig.models.hasOwnProperty('connection')) ?
        envConfig.models.connection : modelsConfig.models.connection;

    // read the Sails mysql config for the env 
    var mysqlParams = connectionsConfig.connections[envConnection];

    // convert sails mysql params to mysql params appropriate for node-myqsl
    var mysqlConfig = {
      port: mysqlParams.options.port,
      host: mysqlParams.options.host,
      user: mysqlParams.user,
      password: mysqlParams.password
    };
    var queryQueue = [];

    // origDB is the database to which you'd like to apply the changes
    var origDB = mysqlParams.database;

    // migrationDB is the temporary database that holds the desired structure
    var migrationDB = 'sailsMigration' + Math.floor(Math.random() * 999999);

    // alter the sails mysql params to use the temporary db
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
    // Some prompts and messages before it starts
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
      if(result.continue.toLowerCase() === 'no') done();

      var connection = mysql.createConnection(mysqlConfig);

      connection.connect(function(err) {
        if (err) done(err);

        // query to drop the migration database if it exists (should never happen)
        var dropQuery = util.format(dropTempDbQueryTemplate, migrationDB);

        // query to create temp db
        var dbQuery = util.format(createTempDbQueryTemplate, migrationDB);
        connection.query(dropQuery, function(err) {
          if (err) done(err);
          connection.query(dbQuery, function(err) {
            if(err) done(err);

            // when we have temp db, lift sails to create the tables with desired structure
            var sails = new Sails();
            sails.lift(sailsConfig, function (err, server) {
              if (err) done(err);

              // query to get all the desired tables
              connection.query(util.format('SHOW TABLES IN `%s`', migrationDB), function(err, tables) {
                if(err) done(err);

                // map the query result into an array
                var tbl = tables.map(function(t) { return t['Tables_in_' + migrationDB]; });

                /* this is the tricky part
                ** we loop through all the desired tables
                ** to produce functions that will
                ** compare them with the same tables in the original DB
                ** and if there is any difference we generate a query
                ** to apply the diff to the original db
                ** the generated function contains the prompt to ask user
                ** whether to run the particular query or not
                */ 
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
                // here we generate the compareQueries in parallel
                async.parallel(compareQueries, function(err, results) {
                  if (err) done(err);

                  // here we switch to the original db
                  connection.query(util.format(switchDBQueryTemplate, origDB), function() {
                    if (err) done(err);

                    // here we execute migration queries one by one
                    async.series(queryQueue, function(err, result) {
                      if (err) done(err);

                      // when all the queries are done, drop the temp db
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
