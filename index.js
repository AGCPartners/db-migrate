var async = require('async');
var Compare = require('./lib/compare.js');
var Execute = require('./lib/execute.js');
var mysql = require('mysql');

function MysqlTransit(origDB, tempDB, config) {
  this.compare = new Compare(origDB, tempDB);
  this.execute = new Execute(origDB);
  this.connection = null;
  this.mysqlConfig = config;

  this._init();
};

MysqlTransit.prototype._init = function() {
  this.connection = mysql.createConnection(config);
};

MysqlTransit.prototype.transit = function(opts, callback) {
  var self = this;
  async.waterfall([
    self.compare(callback),
    this.execute(queries, callback)
  ], function(err, result) {
    if (err) return callback(err);

    callback(null, result);
  });
}

module.exports = MysqlTransit;