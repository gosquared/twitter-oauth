

var express = require('express');
var http = require('http');
var path = require('path');


var express = require('express');
auth = require('../app.js')({
        consumerKey: "ENTER CONSUMER KEY HERE", /* per appications - manage apps here: https://dev.twitter.com/apps */
     consumerSecret: "ENTER CONSUMER SECRET FROM TWITTER HERE", /* per appications - manage apps here: https://dev.twitter.com/apps */
      loginCallback: "http://172.16.0.14:83/twitter/sessions/callback",  /* internal */
   completeCallback:  "http://172.16.0.14:83/search/gosquared",  /* When oauth has finished - where should we take the user too */
             redis: {
                port: 6379,
                host: 'localhost'
             }
});


var app = express.createServer();

app.configure(function(){
  app.set('port', 83);
});

app.use(express.cookieParser());
app.use(express.session({ secret: 'secret key' }));
app.use(express.bodyParser());


app.get('/', function(req, res){
  res.send('<a href="/twitter/sessions/connect">login with twitter</a>');
});

app.get('/search/:term', function(req, res){
  auth.search(req.params.term.split('|'), function(error, data) {
    res.json(data);
  }, req.session.oauthAccessToken, req.session.oauthAccessTokenSecret);
});


app.get('/mentions', function(req, res){
  auth.mentions(function(error, data) {
    res.json(data);
  }, req.session.oauthAccessToken, req.session.oauthAccessTokenSecret);
});


app.get('/user/:handle', function(req, res){
  auth.user(req.params.handle, function(error, data) {
    res.json({
      error: error,
      data: data
    });
  }, req.session.oauthAccessToken, req.session.oauthAccessTokenSecret);
});

app.get('/twitter/sessions/connect', auth.oauthConnect);
app.get('/twitter/sessions/callback', auth.oauthCallback);
app.get('/twitter/sessions/logout', auth.logout);


http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
