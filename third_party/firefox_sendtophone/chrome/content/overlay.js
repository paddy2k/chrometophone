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


// Core functions
Components.utils.import("resource://sendtophone/sendtophone.js");
// Protocol handlers
Components.utils.import("resource://sendtophone/protocolHandlers.js");

var sendtophone = {

	init: function()
	{
		// Each app will implement its specific initialization
	},

	onLoad: function()
	{
		var me = sendtophone;

 		me.strings = document.getElementById("sendtophone-strings");

		me.prefs = Components.classes["@mozilla.org/preferences-service;1"]
										.getService(Ci.nsIPrefService)
										.getBranch("extensions.sendtophone.") ;

		me.init();
	},

	getString: function(name)
	{
		return this.strings.getString(name);
	},

	// Detect images of QR codes generated by the Google Charts API
	detectQR: function( url )
	{
		var match = url.match(/^http:\/\/chart.apis.google.com\/chart\?(.*)/i);
		if (!match)
			return false;

		var chartLink=/^chl=/;
		var qrArray = match[0].split("&");
		for(var qrI=0; qrI<qrArray.length; qrI++){
				if(chartLink.test(qrArray[qrI])){
					//Decode any data encoded in the QR Image Link
					return decodeURIComponent(qrArray[qrI].replace(chartLink, ''));
			}
		}
	},

	onMenuItemCommand: function(e, type)
	{
		var title, url, selection = '';
		switch(type)
		{
			case 'link':
				title = gContextMenu.linkText();
				url = gContextMenu.linkURL;
				break;
			case 'image':
				title = gContextMenu.target.title || gContextMenu.target.alt;
				url = gContextMenu.imageURL || gContextMenu.mediaURL;
				break;
			case 'video':
				title = gContextMenu.target.title || gContextMenu.target.alt;
				url = gContextMenu.imageURL || gContextMenu.mediaURL;
				if(!title)
					title=this.getString("videoTitle");
				break;
			case 'qr':
				title = gContextMenu.target.title || gContextMenu.target.alt;
				url = gContextMenu.imageURL;

				var data = this.detectQR(url);
				if (this.validURI(data))
					url = data;
				else
					selection = data;

				//If the QR Image has no title text, give it one.
				if (!title)
					title=this.getString("qrTitle");

				break;
			case 'text':
				title = "Selection";
				url = 'http://google.com/';
				var input = gContextMenu.target;
				if (gContextMenu.onTextInput && input && input.value)
				{
					selection = input.value.substring(input.selectionStart, input.selectionEnd);
				}
				else
				{
					// Get the selection from the correct iframe
					var focusedWindow = document.commandDispatcher.focusedWindow;
					selection = focusedWindow.getSelection().toString();
				}
				break;

			case 'pageButton':
				// Check if there's a single image with a QR code in the contents
				var images = gBrowser.contentDocument.getElementsByTagName( "img" );

				// 0: search and prompt, 1: search and launch automatically, 2: don't search
				var pref = this.prefs.getIntPref("SearchQR");
				if (pref!=2)
				{
					var QRs = [];
					for( var i=0; i<images.length; i++)
					{
						var imgData = this.detectQR( images[i].src );
						if (imgData)
							QRs.push({data: imgData, img: images[i]});
					}

					if (QRs.length==1)
					{
						var data = QRs[0].data;
						if (pref == 0)
						{
							var question = this.getString("ConfirmQR").replace("%s", data.substring(0, 80)) ;
							var answer = this.confirm( question );
							pref = (answer.confirm ? 1 : 2 );
							if (answer.remember)
								this.prefs.setIntPref("SearchQR", pref);
						}

						if ( pref!=2 )
						{
							title = QRs[0].img.title || QRs[0].img.alt;

							if (this.validURI(data))
								url = data;
							else
								selection = data;

							if (!title)
								title=this.getString("qrTitle");

							// We got the data, break out of the select
							break;
						}
					}
				} // pref != 2

				// fall through
			case 'page':
			default:
				var info = this.getInfo();
				title = info.title;
				url = info.url;
				selection = info.selection;
				break;
		}

		sendtophoneCore.send(title, url, selection);
	},

	// Shows a message in a modal alert
	alert: function(text)
	{
		var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
							.getService(Ci.nsIPromptService);
		promptService.alert(window, this.getString("SendToPhoneTitle"),
			text);
	},

	// Shows a message in a modal confirm
	confirm: function(text)
	{
		var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
							.getService(Ci.nsIPromptService);

		// https://developer.mozilla.org/en/XPCOM_Interface_Reference/nsIPromptService#confirmEx
		var check = {value: false};

		var button =  promptService.confirmEx(window, this.getString("SendToPhoneTitle"),
			text, promptService.STD_YES_NO_BUTTONS, "", "", "", this.getString("RememberMyDecision"), check);
		// confirmEx returns the pressed button, and Yes it's the first one.
		return ({confirm: (0 == button), remember: check.value});
	},

	onToolbarButtonCommand: function(e) {
		// just reuse the function above.
		sendtophone.onMenuItemCommand(e, 'pageButton');
	},

	getInfo: function() {
		var doc = gBrowser.contentDocument,
			href = doc.location.href;

		// Is it the Google Maps page?
		if (this.isMapsURL(href))
		{
			// Then try to send the current view:
			var link = doc.getElementById('link');
			if (link && link.href)
				href = link.href;
		}

		var focusedWindow = document.commandDispatcher.focusedWindow;
		var selection = focusedWindow.getSelection().toString();

		return {
			"title": doc.title,
			"url": href,
			"selection": selection
		};

	},

	isMapsURL: function(url)
	{
		return url.match("http://maps\\.google\\.[a-z]{2,3}(\\.[a-z]{2})?[/?].*") ||	url.match("http://www\\.google\\.[a-z]{2,3}(\\.[a-z]{2})?/maps.*");
	},

	validURI: function(uri)
	{
		return (/^(https?|market|tel|sms(to)?|mailto|ftp):/i).test( uri );
	},

	initPopup: function()
	{
		var fileServerUrl = this.prefs.getCharPref( "fileServerUrl" );
		if (!fileServerUrl)
		{
			document.getElementById("sendtophoneContextMenuSendFiles").hidden = true;
			document.getElementById("sendtophoneContextMenuSendFolder").hidden = true;
		}
		document.getElementById("sendtophoneContextMenuSendClipboard").disabled = !this.clipboardHasText();

		// returning true will make the popup show
		return true;
	},

	clipboardHasText : function()
	{
		var clip = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
		if (!clip) return false;

		if (!clip.hasDataMatchingFlavors(["text/unicode"], 1, clip.kGlobalClipboard))
			return false;

		return true;
	},

	sendClipboard : function()
	{
		// https://developer.mozilla.org/en/using_the_clipboard
		// Access Clipboard
		var clip = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
		if (!clip) return;

		if (!clip.hasDataMatchingFlavors(["text/unicode"], 1, clip.kGlobalClipboard))
			return;

		var trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
		if (!trans) return;
		trans.addDataFlavor("text/unicode");

		// Get the data
		clip.getData(trans, clip.kGlobalClipboard);

		var str       = new Object();
		var strLength = new Object();
		var pastetext;

		trans.getTransferData("text/unicode", str, strLength);

		// Convert to js string
		if (str) str       = str.value.QueryInterface(Components.interfaces.nsISupportsString);
		if (str) pastetext = str.data.substring(0, strLength.value / 2);

		// Send it.
		if (pastetext)
			sendtophoneCore.send("Clipboard", "http://google.com", pastetext);
	},

	logout: function()
	{
		sendtophoneCore.logout();
	}

};

window.addEventListener("load", sendtophone.onLoad, false);
