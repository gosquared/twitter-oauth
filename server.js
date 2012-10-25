  var oauth = require('oauth');


  // main manager function
  /**
   * Manager Function
   *
   * Managers all watchers and url calls to the twitter service.
   *
   * Should eventually be used to monitor usage limits.
   * Handles all oAuth requests.
   */
module.exports = function(options) {
  var self = this;
  if(options.redis) {
    var datastore = require('./redis.js')(options.redis.host, options.redis.port);
  }
  self.cacheDuration = 60; // 60 secs default cache.
  self.consumer = new oauth.OAuth(
    "https://twitter.com/oauth/request_token",
    "https://twitter.com/oauth/access_token",
    options.consumerKey,
    options.consumerSecret,
    "1.0A",
    options.domain + options.loginCallback,
    "HMAC-SHA1"
  );

  /**
   * Fetches the url provided passing along all the oauth params.
   * @param  {string}   url              URL to fetch
   * @param  {Function} callback         Function to call when all data has been completed. Takes error, data
   * @param  {[type]}   oauthToken       Oauth token provided by twitter.
   * @param  {[type]}   oauthTokenSecret Oauth secret provided by twitter.
   */
self.fetch =  function(url, callback, oauthToken, oauthTokenSecret) {
  var self = this;
  var get = function(url, oauthToken, oauthTokenSecret, callback) {
    self.consumer.get(url, oauthToken, oauthTokenSecret, function (error, data, response) {
      if(response && response.headers) {
        // this info should get sent back with each request.
        var limit = response.headers['x-rate-limit-remaining'];
        if(limit === "0") {  //rate limit has not been reached.
          callback({limitReached: true, auth: data}, null);
          return;
        }
      }
      if (error) {
        callback(error, null);
        return;
      }
      try { // sometime data is coming back as invalid json.   https://dev.twitter.com/discussions/9554
        data = JSON.parse(data);
        if(data.error) {
          callback(data, null);
          return;
        }
        if(options.redis) {
          var key = 'twitterStore:'+url;
          datastore.set(key, JSON.stringify(data));
          datastore.expire(key, self.cacheDuration);
        }
        if(callback) {
          callback(null, data, limit);
        }
      } catch(error) {
        // leaving this in  so we can keep an eye of invalid json being returned.
        console.log('ERROR', error);
      }
    });
  };

  if(options.redis) {
    datastore.get('twitterStore:'+url, function(redisError, data) {
      if(redisError || !data){
        get(url, oauthToken, oauthTokenSecret, callback);
      } else {  // we have cached data, lets send that.
        callback(null, JSON.parse(data));
      }
    });
  }else {
    get(url, oauthToken, oauthTokenSecret, callback);
  }
};


  /**
   * Returns mentions for the logged in user.
   *
   * docs: https://dev.twitter.com/docs/api/1.1/get/statuses/mentions_timeline
   *
   * @param  {Function} callback         Called with the mentions. (error, data)
   * @param  {String}   oauthToken       oauth token provided by twitter.
   * @param  {String}   oauthTokenSecret oauth secret provided by twitter.
   * @param  {String}   sinceId only get tweets after this retweet.
   */
  self.retweets = function(callback, oauthToken, oauthTokenSecret, sinceId) {
    var processData = function(error, data, limit) {
      callback(error, {
        limit: limit,
        tweets: data
      });
    };

    var q = (sinceId && sinceId!='false') ? '?since_id='+sinceId : '';
    console.log('https://api.twitter.com/1.1/statuses/mentions_timeline.json'+q);
    self.fetch('https://api.twitter.com/1.1/statuses/mentions_timeline.json'+q, callback, oauthToken, oauthTokenSecret);
  };

  /**
   * Returns info about the user specified by the handle.
   *
   * docs: https://dev.twitter.com/docs/api/1.1/get/users/lookup
   *
   * @param  {Function} callback         Called with the mentions. (error, data)
   * @param  {String}   oauthToken       oauth token provided by twitter.
   * @param  {String}   oauthTokenSecret oauth secret provided by twitter.
   */
  self.user = function(handle, callback, oauthToken, oauthTokenSecret) {
    var processData = function(error, data, limit) {
      callback(error, {
        limit: limit,
        user: data
      });
    };
    self.fetch('https://api.twitter.com/1.1/users/lookup.json?screen_name='+handle, processData, oauthToken, oauthTokenSecret);
  };


  /**
   * Search tweets
   * @param  {String}   term             Search term
   * @param  {Function} callback         Called  once complete (error, data)
   * @param  {[type]}   oauthToken       oauth token provided by twitter.
   * @param  {[type]}   oauthTokenSecret [oauth token provided by secret.
   */
  self.search = function(term, callback, oauthToken, oauthTokenSecret) {
    self.processData = function(error, data, limit) {
      if(error) {
        callback(error, null);
        return error;
      }
      var processTweet = function(tweet) {
        return {
          text: tweet.text,
          image: tweet.user.profile_image_url,
          timestamp: tweet.created_at,
          username: tweet.user.screen_name,
          id: tweet.id,
          url: 'https://twitter.com/' + tweet.from_user + '/status/' + tweet.id_str
        };
      };
      var tweets = data.statuses;
      if(tweets){ // got tweets
        var c = tweets.length;
        var processedTweets = [];
        while(c--) {
          processedTweets.push(processTweet(tweets[c]));
        }
        callback(null, {
          limit: limit,
          tweets: processedTweets.reverse()
        }, limit);
      }else {
        callback(null, null);
      }
    };
    self.fetch('https://api.twitter.com/1.1/search/tweets.json?q='+encodeURI(term)+'', processData, oauthToken, oauthTokenSecret);
  };

  // oauth routes.
  //
  // Come on - you know this one.
  self.logout = function(req, res, next) {
    req.session.oauthAccessToken = null;
    req.session.oauthAccessTokenSecret = null;
    req.session.destroy();
    res.json({'logout': 'ok'});
  };

  // Used to connect using oauth.
  self.oauthConnect = function(req, res, next) {
    var referer = req.header('Referer');
    if(referer && req.session){
      req.session.originalUrl = referer; // stored so we can return them to here later.
    }
    self.consumer.getOAuthRequestToken(function(error, oauthToken, oauthTokenSecret, results){
      if (error) {
        res.send("Error getting OAuth request token : ", 500);
        console.log('oAuth error: '+ error);
      } else {
        req.session.oauthRequestToken = oauthToken; // we will need these values in the oauthCallback so store them on the session.
        req.session.oauthRequestTokenSecret = oauthTokenSecret;
        res.redirect("https://twitter.com/oauth/authorize?oauth_token="+req.session.oauthRequestToken);
      }
    });
  };

  self.oauthCallback = function(req, res, next) {
    self.consumer.getOAuthAccessToken(req.session.oauthRequestToken, req.session.oauthRequestTokenSecret, req.query.oauth_verifier, function(error, oauthAccessToken, oauthAccessTokenSecret, results) {
      if (error) {
        res.send("Access Denied." , 500);
        console.log('oAuth Error: step2: ' + JSON.stringify(error) + "["+oauthAccessToken+"]"+ "["+oauthAccessTokenSecret+"]");
      } else {
        req.session.oauthAccessToken = oauthAccessToken; // ensure we are clearing the session variables.
        req.session.oauthAccessTokenSecret = oauthAccessTokenSecret;
        if(req.session.originalUrl) {
          // go  store the auth token and secret, dashboard should them redirect back to the origin place.
          if(options.storeToken) {
            res.redirect(options.storeToken + 'token='+oauthAccessToken+ '&secret='+oauthAccessTokenSecret+'&url='+encodeURIComponent(req.session.originalUrl));
          }else {
            res.redirect(options.completeCallback);
          }
        }
      }
    });
  };

  /**
   * First attempt at writing middleware - use with great caution.
   */
  self.middleware = function(req, res, next) {
    if(!req.session.oauthAccessToken && !req.session.oauthRequestTokenSecret) { // not idea
      console.log('fail', options.login);
      res.redirect(options.login);
    }else {
      next();
    }
  };
  return self;
};



