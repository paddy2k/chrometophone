/*
 * Copyright 2010 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var apiVersion = 6;

var deviceRegistrationId = localStorage['deviceRegistrationId'];
if (deviceRegistrationId == undefined || deviceRegistrationId == null) {
  deviceRegistrationId = (Math.random() + '').substring(3);
  localStorage['deviceRegistrationId'] = deviceRegistrationId;
}

// For dev purpose can be changed to custom server or specific version,
// use javascript console
var host = localStorage['c2dmHost'];
if (host == undefined) {
	host = "chrometophone.appspot.com";
}
var baseUrl = 'https://' + host;
var sendUrl = baseUrl + '/send?ver=' + apiVersion;

var registerUrl =  baseUrl + '/register?ver=' + apiVersion;

var STATUS_SUCCESS = 'success';
var STATUS_LOGIN_REQUIRED = 'login_required';
var STATUS_DEVICE_NOT_REGISTERED = 'device_not_registered';
var STATUS_GENERAL_ERROR = 'general_error';

var oauth = ChromeExOAuth.initBackgroundPage({
    'request_url' : baseUrl + '/_ah/OAuthGetRequestToken',
    'authorize_url' : baseUrl + '/_ah/OAuthAuthorizeToken',
    'access_url' : baseUrl + '/_ah/OAuthGetAccessToken',
    'consumer_key' : 'anonymous',
    'consumer_secret' : 'anonymous',
    'scope' : baseUrl,
    'app_name' : 'Chrome To Phone'
});


var channel;
var socket;

function sendToPhone(title, url, msgType, selection, listener) {
    if (oauth.hasToken()) {
        // OAuth1 and url-encoded is a nightmare ( well, Oauth1 is a nightmare in all cases,
        // this is worse )
        var params = {
                "title": title,
                "url": url, 
                "sel": selection,
                "type": msgType,
                "deviceType":"ac2dm",
                "debug": "1",
                "token": localStorage['deviceRegistrationId'] 
        };
        // no longer passing device name - this may be customized
        var data = JSON.stringify(params);
        oauth.sendSignedRequest(baseUrl + "/send", function(responseText, req) {
            if (req.status == 200) {
                var body = req.responseText;
                if (body.indexOf('OK') == 0) {
                    listener(STATUS_SUCCESS);
                } else if (body.indexOf('LOGIN_REQUIRED') == 0) {
                    listener(STATUS_LOGIN_REQUIRED);
                } else if (body.indexOf('DEVICE_NOT_REGISTERED') == 0) {
                    listener(STATUS_DEVICE_NOT_REGISTERED);
                }
            } else {
                listener(STATUS_GENERAL_ERROR);
            }
        }, {
            'method': 'POST',
            'body': data,
            'headers': {
                'X-Same-Domain': 'true',
                'Content-Type': 'application/json'  
            }
        });
        return;
    } else {
        listener(STATUS_LOGIN_REQUIRED);
    }
}

function initializeBrowserChannel() {
  if (!oauth.hasToken()) {
	  console.log('registration required for initializeBrowserChannel');
	  return;
  }
  console.log('Initializing browser channel');
  var params = {
		  "devregid": deviceRegistrationId,
		  "deviceId": deviceRegistrationId,
		  "ver": apiVersion,
		  "deviceType": "chrome",
		  "debug":"1",
		  "deviceName":"Chrome"
  };
  var data = JSON.stringify(params);
  
  oauth.sendSignedRequest(baseUrl + "/register", function(responseText, req) {
	        if (req.status == 200) {
	          var channelId = req.responseText.substring(3).trim();  // expect 'OK <id>';
	          channel = new goog.appengine.Channel(channelId);
              console.log('Attempting to open ' + channelId);
	          socket = channel.open();
	          socket.onopen = function() {
	                console.log('Browser channel initialized');
	          }
	          socket.onclose = function() {
	            console.log('Browser channel closed');
	            setTimeout('initializeBrowserChannel()', 0); 
	          }
	          socket.onerror = function(error) {
	            if (error.code == 401) {  // token expiry
	              console.log('Browser channel token expired - reconnecting');
	            } else {
	              console.log('Browser channel error');
	              // Automatically reconnects
	            }
	          }
	          socket.onmessage = function(evt) {
	            console.log("Onmessage " + evt.data);
	            var url = unescape(evt.data);
	            var regex = /http[s]?:\/\//;
	            if (regex.test(url)) { 
	              chrome.tabs.create({url: url})
	            }
	          }
	        } else if (req.status == 400) {
	          if (req.responseText.indexOf('LOGIN_REQUIRED') == 0) {
	            console.log('Not initializing browser channel because user not logged in');
	          } else if (req.responseText.indexOf('NOT_ENABLED') == 0) {
	            console.log('Not initializing browser channel because feature not enabled for user');
	          }
	        }
     }, {
	  'method': 'POST',
	  'body': data,
	  'headers': {
		  'X-Same-Domain': 'true',
		  'Content-Type': 'application/json'  
	  }
  });
}

// Callback from oauth - we can now register the chrome channel
function oauthGotTokenCallback(token, secret) {
      initializeBrowserChannel();
}


function setSignOutVisibility(visible) {
	  var signOutLink = document.getElementById('signout');
	  signOutLink.style.visibility = visible ? 'visible' : 'hidden';
	  var sep = document.getElementById('sep');
	  if (sep != null) {
	    sep.style.visibility = visible ? 'visible' : 'hidden';
	  }
}

function activateSignOutLink() {
	  setSignOutVisibility(true);
	  var signOutLink = document.getElementById('signout');
      signOutLink.innerHTML = chrome.i18n.getMessage('sign_out_message');
	  signOutLink.style.color = 'blue';
	  signOutLink.onclick = function() {
		  oauth.clearTokens();
		  chrome.tabs.create({url: 'help.html'})
	  }	  
}

function activateSignInLink(onclick) {
    var link = '<a href="#" onclick="' + onclick + '">' +
       chrome.i18n.getMessage('sign_in_message') + '</a>';
    document.getElementById('msg').innerHTML =
       chrome.i18n.getMessage('sign_in_required_message', link);
    setSignOutVisibility(false);
    
}

