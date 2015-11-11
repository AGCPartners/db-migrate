var assert = require('assert');
var mysql = require('mysql');
var should = require('chai').should();
var MysqlTransit = require('../index');

var connectionParams = {
  'host': (process.env.MYSQL_TEST_HOST) ? process.env.MYSQL_TEST_PORT : 'localhost',
  'port': (process.env.MYSQL_TEST_PORT) ? process.env.MYSQL_TEST_PORT : 3306,
  'user': (process.env.MYSQL_TEST_USER) ? process.env.MYSQL_TEST_PORT : 'root',
  'password': (process.env.MYSQL_TEST_PASSWORD) ? process.env.MYSQL_TEST_PORT : 'root'
};
var connection,
  createOriginalDatabase,
  originalDatabaseName,
  createTempDatabase,
  tempDatabaseName,
  testTable,
  testColumn;

describe('When run mysql transit non interactive', function() {

  before(function(done) {
    connection = mysql.createConnection(connectionParams);

    connection.connect(function(err) {
      if (err) return done(err);

      originalDatabaseName = 'mysqltransitoriginal_test_' + Date.now();
      createOriginalDatabase = 'CREATE DATABASE IF NOT EXISTS `' + originalDatabaseName + '`;';
      connection.query(createOriginalDatabase, function(err, res) {
        if (err) return done(err);

        tempDatabaseName = 'mysqltransittemp_test_' + Date.now();
        createTempDatabase = 'CREATE DATABASE IF NOT EXISTS `' + tempDatabaseName + '`;';
        connection.query(createTempDatabase, function(err, res) {
          if (err) return done(err);

          testTable = 'Test';
          createTable(connection, testTable, tempDatabaseName, function(err, result) {
            if (err) return done(err);

            return done();
          })
        });
      });

    });
  });

  describe('and there is a new table in temp database', function() {
    it('it should be replicated also in the original database', function(done) {
      var mysqlTransit = new MysqlTransit(originalDatabaseName, tempDatabaseName, connectionParams);

      mysqlTransit.transit({ interactive: false }, function(err, transitResult) {
        if (err) return done(err);

        var checkNewTableExists = 'SELECT * FROM information_schema.tables ' +
          'WHERE table_schema = \'' + originalDatabaseName + '\' ' +
          'AND table_name = \'' + testTable + '\' ' +
          'LIMIT 1;';
        connection.query(checkNewTableExists, function(err, result) {
          if (err) return done(err);

          result.length.should.equal(1);
          return done();
        });
      })
    });
  });
});

describe('When run mysql transit non interactive', function() {
  before(function(done) {
    testColumn = 'name';
    var addColumnQuery = 'ALTER TABLE `' + tempDatabaseName + '`.`' + testTable + '` ADD ' + testColumn + ' INT(11);';
    connection.query(addColumnQuery, function(err, res) {
      if (err) return done(err);

      return done();
    })
  });

  describe('and there is a new column in temp database', function() {
    it('it should be replicated also in the original database', function(done) {
      var mysqlTransit = new MysqlTransit(originalDatabaseName, tempDatabaseName, connectionParams);

      mysqlTransit.transit({ interactive: false }, function(err, transitResult) {
        if (err) return done(err);

        var checkNewColumnExists = 'SELECT * FROM information_schema.COLUMNS ' +
          'WHERE table_schema = \'' + originalDatabaseName + '\' ' +
          'AND table_name = \'' + testTable + '\' ' +
          'AND column_name = \'' + testColumn + '\' ';
        connection.query(checkNewColumnExists, function(err, result) {
          if (err) return done(err);

          result.length.should.equal(1);
          result[0].COLUMN_TYPE.should.equal('int(11)');
          return done();
        });
      })
    });
  });
});


describe('When run mysql transit non interactive', function() {
  before(function(done) {
    var modifyColumnQuery = 'ALTER TABLE `' + tempDatabaseName + '`.`' + testTable + '` MODIFY ' + testColumn + ' VARCHAR (60);';
    connection.query(modifyColumnQuery, function(err, res) {
      if (err) return done(err);

      return done();
    })
  });

  describe('and the type of a column has changes in temp database', function() {
    it('it should be replicated also in the original database', function(done) {
      var mysqlTransit = new MysqlTransit(originalDatabaseName, tempDatabaseName, connectionParams);

      mysqlTransit.transit({ interactive: false }, function(err, transitResult) {
        if (err) return done(err);

        var checkNewColumnExists = 'SELECT * FROM information_schema.COLUMNS ' +
          'WHERE table_schema = \'' + originalDatabaseName + '\' ' +
          'AND table_name = \'' + testTable + '\' ' +
          'AND column_name = \'' + testColumn + '\' ';
        connection.query(checkNewColumnExists, function(err, result) {
          if (err) return done(err);

          result.length.should.equal(1);
          result[0].COLUMN_TYPE.should.equal('varchar(60)');
          return done();
        });
      })
    });
  });
});

describe('When run mysql transit non interactive', function() {
  before(function(done) {
    var dropColumnQuery = 'ALTER TABLE `' + tempDatabaseName + '`.`' + testTable + '` DROP ' + testColumn + ';';
    connection.query(dropColumnQuery, function(err, res) {
      if (err) return done(err);

      return done();
    })
  });

  describe('and a column is dropped in temp database', function() {
    it('it should be still available in the original database', function(done) {
      var mysqlTransit = new MysqlTransit(originalDatabaseName, tempDatabaseName, connectionParams);

      mysqlTransit.transit({ interactive: false }, function(err, transitResult) {
        if (err) return done(err);

        var checkNewColumnExists = 'SELECT * FROM information_schema.COLUMNS ' +
          'WHERE table_schema = \'' + originalDatabaseName + '\' ' +
          'AND table_name = \'' + testTable + '\' ' +
          'AND column_name = \'' + testColumn + '\' ';
        connection.query(checkNewColumnExists, function(err, result) {
          if (err) return done(err);

          result.length.should.equal(1);
          result[0].COLUMN_TYPE.should.equal('varchar(60)');
          return done();
        });
      })
    });
  });
});

describe('When run mysql transit non interactive', function() {
  before(function(done) {
    var dropTable = 'DROP TABLE `' + tempDatabaseName + '`.`' + testTable + ';';
    connection.query(dropTable, function(err, res) {
      if (err) return done(err);

      return done();
    })
  });

  describe('and a table is dropped in temp database', function() {
    it('it should be still available in the original database', function(done) {
      var mysqlTransit = new MysqlTransit(originalDatabaseName, tempDatabaseName, connectionParams);

      mysqlTransit.transit({ interactive: false }, function(err, transitResult) {
        if (err) return done(err);

        var checkNewTableExists = 'SELECT * FROM information_schema.tables ' +
          'WHERE table_schema = \'' + originalDatabaseName + '\' ' +
          'AND table_name = \'' + testTable + '\' ' +
          'LIMIT 1;';
        connection.query(checkNewTableExists, function(err, result) {
          if (err) return done(err);

          result.length.should.equal(1);
          return done();
        });
      })
    });
  });

  after(function(done) {
    connection.query('DROP DATABASE IF EXISTS `' + originalDatabaseName + '`;', function(err, res) {
      if (err) return done(err);

      connection.query('DROP DATABASE IF EXISTS `' + tempDatabaseName + '`;', function(err, res) {
        if (err) return done(err);

        return done();
      });
    });
  });
});

function createTable(connection, tableName, dbname, cb) {
  var query = 'CREATE TABLE `' + dbname + '`.`' + tableName + '` ' +
    '(`id` INT(11) PRIMARY KEY);';
  connection.query(query, function(err, result) {
    if (err) return cb(err);

    return cb(null, result);
  })
};

