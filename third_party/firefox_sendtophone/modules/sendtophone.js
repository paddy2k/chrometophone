/*
    Copyright 2010 Alfonso Martínez de Lizarrondo & Patrick O'Reilly

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

// https://developer.mozilla.org/en/JavaScript_code_modules/Using_JavaScript_code_modules
var EXPORTED_SYMBOLS = ["sendtophoneCore"];

const Cc = Components.classes;
const Ci = Components.interfaces;

var sendtophoneCore = {
	req : null,
	apiVersion : 4,
	loggedInUrl : "http://code.google.com/p/chrometophone/logo?login",
	loggedOutUrl : "http://code.google.com/p/chrometophone/logo?logout",
	apkUrl : "http://code.google.com/p/chrometophone/wiki/AndroidApp",

	init: function()
	{
		this.strings = Cc["@mozilla.org/intl/stringbundle;1"]
						.getService(Ci.nsIStringBundleService)
						.createBundle("chrome://sendtophone/locale/overlay.properties");

		this.prefs = Cc["@mozilla.org/preferences-service;1"]
						.getService(Ci.nsIPrefService)
						.getBranch("extensions.sendtophone.") ;

		// Allow the people to use their own server if they prefer to not trust this server
		var baseUrl = this.prefs.getCharPref( "appUrl" ) ;

		this.sendUrl = baseUrl + '/send?ver=' + this.apiVersion;
		this.logInUrl = baseUrl + '/signin?ver=' + this.apiVersion + '&extret=' + encodeURIComponent(this.loggedInUrl);
		this.logOutUrl = baseUrl + '/signout?ver=' + this.apiVersion + '&extret=' + encodeURIComponent(this.loggedOutUrl);
	},

	getString: function(name)
	{
		return this.strings.GetStringFromName(name);
	},

	// Shows a message in a modal alert
	alert: function(text)
	{
		var promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"]
							.getService(Ci.nsIPromptService);
		promptService.alert(null, this.getString("SendToPhoneTitle"),
			text);
	},

	// Shows a message in a growl-like notification
	popupNotification: function(text)
	{
		var title = this.getString("SendToPhoneTitle");
		var image = "chrome://sendtophone/skin/icon.png";
		try {
			// Avoid crash on Fedora 12.
			// Reported on 8th June https://addons.mozilla.org/en-US/firefox/reviews/display/161941
			var listener = {
				observe: function(subject, topic, data) {}
			};

			Cc['@mozilla.org/alerts-service;1']
								.getService(Ci.nsIAlertsService)
								.showAlertNotification(image, title, text, false, '', listener);
		} catch(e)
		{
			// prevents runtime error on platforms that don't implement nsIAlertsService
				var win = Cc['@mozilla.org/embedcomp/window-watcher;1']
										.getService(Ci.nsIWindowWatcher)
										.openWindow(null, 'chrome://global/content/alerts/alert.xul',
													'_blank', 'chrome,titlebar=no,popup=yes', null);
				win.arguments = [image, title, text, false, ''];
		}
	},

	// For use while debugging
	toConsole: function(text)
	{
		var aConsoleService = Cc["@mozilla.org/consoleservice;1"]
				.getService(Ci.nsIConsoleService);

		aConsoleService.logStringMessage( text );
	},
	
	processXHR: function(url, method, data, callback)
	{
		var req = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
						.createInstance(Ci.nsIXMLHttpRequest);

		req.open(method, url, true);
		req.setRequestHeader('X-Same-Domain', 'true');  // XSRF protector

		if (method=='POST')
			req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

		req.onreadystatechange = function()
		{
			// here this == req
			if (this.readyState == 4)
			{
				var body = req.responseText;
				if (req.status == 200)
				{
					// Check if the body is a html redirect
					var redirectMatch = body.match(/<meta http-equiv="refresh" content="\d;\s*url=(&#39;)?(.*)\1">/);
					if (redirectMatch)
					{
						var redirectUrl = redirectMatch[2].replace(/&amp;/g, '&');
						if (redirectUrl == sendtophoneCore.loggedOutUrl)
						{
							sendtophoneCore.logoutSuccessful();
							return;
						}
						// Do the redirect and use the original callback
						sendtophoneCore.processXHR( redirectUrl, 'GET', null, callback);
					}
					else
						callback.call( sendtophoneCore, req );
				}
				else
				{
					if (req.status==500 && body.substr(0,27) =="ERROR (Unable to send link)")
						sendtophoneCore.openTab( "http://www.foxtophone.com/status500/" );
					else
						sendtophoneCore.alert(sendtophoneCore.getString("ErrorOnSend") + ' (status ' + req.status + ')\r\n' + body);
				}
			}
		};

		// To send correctly cookies.
		// Force the request to include cookies even though this chrome code
		// is seen as a third-party, so the server knows the user for which we are
		// requesting favorites (or anything else user-specific in the future).
		// This only works in Firefox 3.6; in Firefox 3.5 the request will instead
		// fail to send cookies if the user has disabled third-party cookies.
		try {
			req.channel.QueryInterface(Ci.nsIHttpChannelInternal).
				forceAllowThirdPartyCookie = true;
		}
		catch(ex) { /* user is using Firefox 3.5 */ }

		req.send( data );
	},

	// Main function
	// This is method that has to be called from outside this module
	// The other available method is sendFile
	send: function(title, url, selection)
	{
		if (!this.sendUrl)
			this.init();
			
		// Local files: upload them to a web server
		if ((/^file:/i).test(url))
		{
			var nsFile = Cc["@mozilla.org/network/io-service;1"]
				.getService(Ci.nsIIOService)
				.getProtocolHandler("file")
				.QueryInterface(Ci.nsIFileProtocolHandler)
				.getFileFromURLSpec(url);
			this.sendFile(nsFile);
			return;
		}
		
		if (!(/^(https?|market|tel|sms(to)?|mailto|ftp):/i).test( url ))
		{
			this.alert(this.getString("InvalidScheme"));
			return;
		}			
	
		var max_length = 1024;
		if (selection.length > max_length)
			selection = selection.substring(0, max_length);
		
		// Send the protocols that aren't currently whitelisted through a proxy server
		if (!(/^(https?):/i).test( url ))
		{
			// Rewrite the URI so it's send first to the proxy
			var proxyUrl = this.prefs.getCharPref( "proxyUrl" );
			if (proxyUrl)
				url = proxyUrl + encodeURIComponent( url);
		}

		var data = 'title=' + encodeURIComponent(title) +
				'&url=' + encodeURIComponent(url) + '&sel=' + encodeURIComponent(selection);

		this.pendingMessage = data;
		this.processXHR(this.sendUrl, 'POST', data, this.processSentData);
	},

	processSentData : function(req)
	{
		var body = req.responseText;

		if (body.substring(0, 2) == 'OK')
		{
			delete this.pendingMessage;
			this.popupNotification(this.getString("InfoSent"));
			return;
		}
		if (body.indexOf('LOGIN_REQUIRED') == 0)
		{
			this.popupNotification( this.getString("LoginRequired") );

			//Open Google login page and close tab when done
			this.openTab(this.logInUrl, this.loggedInUrl, function() {sendtophoneCore.loginSuccessful();} );

			return;
		}
		if (body.indexOf('DEVICE_NOT_REGISTERED') == 0)
		{
			this.popupNotification(this.getString("DeviceNotRegistered"));

			// Open tab with apk download
			this.openTab(this.apkUrl);
			return;
		}

		this.alert(this.getString("ErrorOnSend") + '\r\n' + body);
	},

	logout: function()
	{
		if (!this.prefs)
			this.init();
			
		// Open Google logout page, and close tab when finished
		this.openTab(this.logOutUrl, this.loggedOutUrl, function() {sendtophoneCore.logoutSuccessful();} );

/*
		// This doesn't work if third party cookies are bloqued. Why???
		this.processXHR(this.logOutUrl, 'GET', null, function(req)
			{
				// This will be called only if there's a problem
				this.alert(this.getString("LogoutError") + '\r\n' + req.responseText );
			});
			*/
	},

	openTab: function(url, successUrl, callback)
	{
		var gBrowser = Cc["@mozilla.org/appshell/window-mediator;1"]
			.getService(Ci.nsIWindowMediator)
			.getMostRecentWindow("navigator:browser")
			.gBrowser;

		var lastTabIndex = gBrowser.tabContainer.selectedIndex;
		var tab = gBrowser.addTab(url);
		gBrowser.selectedTab = tab;

		if (successUrl && callback)
		{
			var c2pTab = gBrowser.getBrowserForTab(tab);
			//Add listener for callback URL
			c2pTab.addEventListener("load", function () {
				if(successUrl==c2pTab.currentURI.spec){
					callback();

					// Close tab
					gBrowser.removeTab(tab);
					// ReFocus on tab being sent
					gBrowser.selectedTab = gBrowser.tabContainer.childNodes[lastTabIndex];
				}
			}, true);
		}
	},

	logoutSuccessful: function()
	{
		this.popupNotification(this.getString("LogoutSuccessful"));
	},

	loginSuccessful: function()
	{
		this.popupNotification( this.getString("LoginSuccessful") );

		// Send pending message
		this.processXHR(this.sendUrl, 'POST', this.pendingMessage, this.processSentData);
	},
	
	toUTF8: function(str)
	{
		var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
			.createInstance(Ci.nsIScriptableUnicodeConverter);
		converter.charset = "utf-8";
		var data = converter.ConvertFromUnicode(str);
		return data + converter.Finish();
	},
		
	sendFile: function( nsFile, callback )
	{
		if (!this.prefs)
			this.init();

		let uri = this.prefs.getCharPref( "fileServerUrl" );
		if (!uri)
		{
			this.alert( this.getString("FileUploadsDisabled") );
			return;
		}
	
		if (typeof sendtophoneUploadsManager == "undefined")
			Components.utils.import("resource://sendtophone/uploadsManager.js");
	
		if (nsFile.isDirectory())
		{
			// There's no progress notification while compressing, only on end.
			let progressId = sendtophoneUploadsManager.addZip(nsFile);
			// Compress the contents to a zip file
			zipFolder(nsFile, function(nsZip)
				{
					sendtophoneUploadsManager.finishedUpload( progressId );
					
					// Send the zip and delete it afterwards
					sendtophoneCore.sendFile(nsZip, function() { nsZip.remove(false) });
				}
			)
			return;
		}
		
		if (!nsFile.isFile())
		{
			this.alert(this.getString("InvalidFile"));
			return;
		}

		let size = Math.round(nsFile.fileSize / 1024);	 
		let maxSize = this.prefs.getIntPref( "fileUploadMaxKb" );
		if (maxSize>0 && size>maxSize)
		{
			this.alert( this.getString("FileTooBig") );
			return;
		}
		
		let uploadName = nsFile.leafName;
		// Try to determine the MIME type of the file  
		var mimeType = "text/plain";  
		try {  
		var mimeService = Cc["@mozilla.org/mime;1"]  
			.getService(Ci.nsIMIMEService);  
		mimeType = mimeService.getTypeFromFile(nsFile); // nsFile is an nsIFile instance  
		}  
		catch(e) { /* eat it; just use text/plain */ }  
	
		// Buffer the upload file
		var inStream = Cc["@mozilla.org/network/file-input-stream;1"]
			.createInstance(Ci.nsIFileInputStream);
		inStream.init(nsFile, 1, 1, inStream.CLOSE_ON_EOF);
		var bufInStream = Cc["@mozilla.org/network/buffered-input-stream;1"]
			.createInstance(Ci.nsIBufferedInputStream);
		bufInStream.init(inStream, 4096);

		//Setup the boundary start stream
		var boundary = "--SendToPhone-------------" + Math.random();
		var startBoundryStream = Cc["@mozilla.org/io/string-input-stream;1"]
			.createInstance(Ci.nsIStringInputStream);
		startBoundryStream.setData("\r\n--"+boundary+"\r\n",-1);

		// Setup the boundary end stream
		var endBoundryStream = Cc["@mozilla.org/io/string-input-stream;1"]
				.createInstance(Ci.nsIStringInputStream);
		endBoundryStream.setData("\r\n--"+boundary+"--",-1);

		// Setup the mime-stream - the 'part' of a multi-part mime type
		var mimeStream = Cc["@mozilla.org/network/mime-input-stream;1"].createInstance(Ci.nsIMIMEInputStream);
		mimeStream.addContentLength = false;
		mimeStream.addHeader("Content-disposition","form-data; charset: utf-8; name=\"upload\"; filename=\"" + this.toUTF8(uploadName) + "\"");
		mimeStream.addHeader("Content-type", mimeType);
		mimeStream.setData(bufInStream);
	
		// Setup a multiplex stream
		var multiStream = Cc["@mozilla.org/io/multiplex-input-stream;1"]
			.createInstance(Ci.nsIMultiplexInputStream);
		multiStream.appendStream(startBoundryStream);
		multiStream.appendStream(mimeStream);
		multiStream.appendStream(endBoundryStream);
		
		var req = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
				.createInstance(Ci.nsIXMLHttpRequest);

		// Show the progress of uploads
		sendtophoneUploadsManager.addUpload(nsFile, req);

		req.open('POST', uri, true);

		req.setRequestHeader("Content-length",multiStream.available());
		req.setRequestHeader("Content-type","multipart/form-data; charset: utf-8; boundary="+boundary);
		req.addEventListener("load", function(event)
		{
			// If there's a callback (to delete temporary files) we call it now
			if (callback)
				callback();
				
			var body = event.target.responseXML;
			var uploads;
			if (body && (uploads = body.documentElement.getElementsByTagName("upload")))
			{
				var data = uploads[0].firstChild.data;
//				sendtophoneCore.toConsole(data);
				sendtophoneCore.send(uploadName, data, "");
				return;
			}
			// error.
			sendtophoneCore.alert(uri + "\r\n" + event.target.responseText);
		}, false);
		// Handle errors or aborted uploads
		req.addEventListener("error", function(evt)
		{
			sendtophoneCore.alert("Error while sending the file to the server:\r\n" + uri);
			
			// If there's a callback (to delete temporary files) we call it now
			if (callback)
				callback();
		}, false);
		req.addEventListener("abort", function(evt)
		{
			// Silent.
			
			// If there's a callback (to delete temporary files) we call it now
			if (callback)
				callback();
		}, false);
		
		/*
		if required for cookies... don't think so.
		try {
		  req.channel.QueryInterface(Ci.nsIHttpChannelInternal).
			forceAllowThirdPartyCookie = true;
		}
		catch(ex) {}
		*/
		req.send(multiStream);
	}

	
};

/* Zipping functions */
const PR_RDONLY      = 0x01;
const PR_WRONLY      = 0x02;
const PR_RDWR        = 0x04;
const PR_CREATE_FILE = 0x08;
const PR_APPEND      = 0x10;
const PR_TRUNCATE    = 0x20;
const PR_SYNC        = 0x40;
const PR_EXCL        = 0x80;

/**
* folder is a nsFile pointing to a folder
* callback is a function that it's called after the zip is created. It has one parameter: the nsFile created
*/
function zipFolder(folder, callback)
{
	// get TMP directory  
	var nsFile = Cc["@mozilla.org/file/directory_service;1"].  
			getService(Ci.nsIProperties).  
			get("TmpD", Ci.nsIFile); 

	// Create a new file
	nsFile.append( folder.leafName  + ".zip");
	nsFile.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0666);  
	
	var zipWriter = Components.Constructor("@mozilla.org/zipwriter;1", "nsIZipWriter");
	var zipW = new zipWriter();
	
	zipW.open(nsFile, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);
	
	addFolderContentsToZip(zipW, folder, "");
	
	// We don't want to block the main thread, so the zipping is done asynchronously
	// and here we get the notification that it has finished
	var observer = {
		onStartRequest: function(request, context) {},
		onStopRequest: function(request, context, status)
		{
			zipW.close();
			// Notify that we're done. Now it must be sent and deleted afterwards
			callback(nsFile);
		}
	}

	zipW.processQueue(observer, null);
}

/**
* function to add the contents of a folder recursively
* zipW a nsIZipWriter object
* folder a nsFile object pointing to a folder
* root a string defining the relative path for this folder in the zip
*/
function addFolderContentsToZip(zipW, folder, root)
{
	var entries = folder.directoryEntries;  
	while(entries.hasMoreElements())  
	{  
		var entry = entries.getNext();  
		entry.QueryInterface(Ci.nsIFile);  
		zipW.addEntryFile(root + entry.leafName, Ci.nsIZipWriter.COMPRESSION_DEFAULT, entry, true);
		if (entry.isDirectory())
			addFolderContentsToZip(zipW, entry, root + entry.leafName + "/");
	} 
}