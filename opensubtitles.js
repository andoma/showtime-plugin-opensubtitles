/*
 *  Opensubtitles plugin for Movian Media Center
 *
 *  Copyright (C) 2013-2015 Andreas Öman
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var settings = require('showtime/settings');
var subtitles = require('showtime/subtitles');
var xmlrpc = require('showtime/xmlrpc');
var popup = require('native/popup');

var APIURL = "http://api.opensubtitles.org/xml-rpc";
var token = null;
var usernname = '';
var password = '';

var logo = Plugin.path + "logo.jpg";

function trace(str) {
  console.log(str, 'opensubtitles');
}

var sg = new settings.globalSettings("opensubtitles",
                                     "Opensubtitles",
                                     logo,
                                     "Login details for opensubtitles");

sg.createString("username", "Username", "", function(v) {
  username = v;
  token = null;
});

sg.createString("password", "Password", "", function(v) {
  password = v;
  token = null;
});

function login(force) {

  if(token === null || force) {
    trace('Attempting to login as: ' + (username ? username : 'Anonymous'));

    var r;
    try {
      var r = xmlrpc.call(APIURL, "LogIn", username, password, 'en',
			  'Showtime ' + Core.currentVersionString);
    } catch(err) {
      trace("Cannot send login to opensubtitles: " + err);

      if(force)
        popup.notify('Opensubtitles login failel: ' + err, 5, logo);
      return;
    }

    if(r[0].status == '200 OK') {
      token = r[0].token;
      trace('Login OK');
    } else {
      token = null;
      trace('Login failed: ' + r[0].status);
      if(force)
        popup.notify('Opensubtitles login failed: ' + r[0].status, 5, logo);
    }
  }
}


new subtitles.addProvider(function(req) {

  var queries = [];

  if(req.duration < 5 * 60)
    return; // Don't query about clips shorter than 5 minutes

  // Get list of user preferred languages for subs
  var lang = subtitles.getLanguages().join(',');

  // Build a opensubtitle query based on request from Movian

  if(req.filesize > 0 && req.opensubhash !== undefined) {
    queries.push({
      sublanguageid: lang,
      moviehash: req.opensubhash,
      moviebytesize: req.filesize.toString()
    });
  }
  if(req.imdb && req.imdb.indexOf('tt') == 0) {
    queries.push({
      sublanguageid: lang,
      imdbid: req.imdb.substring(2),
      season: req.season,
      episode: req.episode
    });
  } else if(req.title) {
    queries.push({
      sublanguageid: lang,
      query: req.title,
      season: req.season,
      episode: req.episode
    });
  }

  // Loop so we can retry once (relogin) if something fails
  // This typically happens if the token times out

  for(var retry = 0; retry < 2; retry++) {
    login(retry);

    var r;
    try {
      r = xmlrpc.call(APIURL, "SearchSubtitles", token, queries);
    } catch(err) {
      trace("Cannot send search query to opensubtitles: " + err);
      return;
    }
    
    if(r[0].status == '200 OK' && typeof(r[0].data == 'object')) {
      var set = {}; // We can get same subtitle multiple times, so keep track
      var cnt = 0;
      var len = r[0].data.length;
      for(var i = 0; i < len; i++) {
	var sub = r[0].data[i];
	var url = sub.SubDownloadLink;
        if(sub.MatchedBy == 'fulltext' && sub.subLastTS) {
          var a = sub.SubLastTS.split(':');
          if(a.length == 3) {
            var seconds = (+a[0]) * 3600 + (+a[1]) * 60 + (+a[2]);
            if(seconds < 30000 && seconds > req.duration * 1.1) {
              //                console.log("Skipping " + url + " " + seconds + "(" +  sub.SubLastTS + ") > " + req.duration * 1.1);
              continue;
            }
          }
        }

	if(url in set)
	  continue;

	set[url] = true;

	var score = 0;
	if (sub.MatchedBy == 'moviehash')
	  score++; // matches by file hash is better

        if ((req.season == sub.SeriesSeason) && (req.episode == sub.SeriesEpisode))
          score += 2; // matches by season and episode is even better

        var localurl = "opensubtitlefs://" + url.replace(/\/sid-[^\/]+\//, '/__SID_TOKEN__/')

	req.addSubtitle(localurl, sub.SubFileName, sub.SubLanguageID,
			sub.SubFormat,
			'opensubtitles (' + sub.MatchedBy + ')',
			score);
	cnt++;
      }
      trace('Added ' + cnt + ' subtitles');

      return;
    } else {
      trace('Query failed: ' + r[0].status);
    }
  }
});



var fap = require('native/faprovider');

fap.register('opensubtitlefs', {

  redirect: function(handle, url) {
    console.log("Redirect: " + url);

    for(var retry = 0; retry < 2; retry++) {
      // Verify that our token is still valid
      login(retry);

      r = xmlrpc.call(APIURL, "NoOperation", token);
      if(r[0].status == '200 OK') {

        var realurl = url.replace(/__SID_TOKEN__/, 'sid-' + token);
        console.log("Redirecting " + url + " to " + realurl);

        fap.redirectRespond(handle, true, realurl);
        return;
      }
    }
    fap.redirectRespond(handle, false, 'Unable to access opensubtitles');
  }
});

