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
package com.google.android.apps.chrometophone;


import java.io.IOException;

import org.apache.http.client.ClientProtocolException;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.DefaultHttpClient;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Bundle;
import android.text.ClipboardManager;
import android.util.Log;

import com.google.android.c2dm.C2DMBaseReceiver;

public class C2DMReceiver extends C2DMBaseReceiver {
    private static final String TAG = "C2DMReceiver";

    public C2DMReceiver() {
        super(DeviceRegistrar.SENDER_ID);
    }

    @Override
    public void onRegistrered(Context context, String registration) {
        DeviceRegistrar.registerWithServer(context, registration);
    }

    @Override
    public void onUnregistered(Context context) {
        SharedPreferences prefs = Prefs.get(context);
        String deviceRegistrationID = prefs.getString("deviceRegistrationID", null);
        DeviceRegistrar.unregisterWithServer(context, deviceRegistrationID);
    }

    @Override
    public void onError(Context context, String errorId) {
        context.sendBroadcast(new Intent("com.google.ctp.UPDATE_UI"));
    }

    @Override
    public void onMessage(Context context, Intent intent) {
       Bundle extras = intent.getExtras();
       if (extras != null) {
           String url = (String) extras.get("url");
           String title = (String) extras.get("title");
           String sel = (String) extras.get("sel");
           String debug = (String) extras.get("debug");
           if (debug != null) {
               // server-controlled debug - the server wants to know
               // we received the message, and when. This is not user-controllable,
               // we don't want extra traffic on the server or phone. Server may
               // turn this on for a small percentage of requests or for users
               // who report issues.
               DefaultHttpClient client = new DefaultHttpClient();
               HttpGet get = new HttpGet(DeviceRegistrar.BASE_URL + "/debug?id="
                       + extras.get("collapse_key"));
               // No auth - the purpose is only to generate a log/confirm delivery
               // (to avoid overhead of getting the token)
               try {
                   client.execute(get);
               } catch (ClientProtocolException e) {
                   // ignore
               } catch (IOException e) {
                   // ignore
               }
           }
           if (url != null && title != null) {
               if (url.startsWith("http")) {
                   // Put selection in clipboard
                   if (sel != null) {
                       ClipboardManager cm =
                               (ClipboardManager) context.getSystemService(CLIPBOARD_SERVICE);
                       cm.setText(sel);
                   }

                   // Action for phone numbers
                   SharedPreferences settings = Prefs.get(context);
                   if (settings.getBoolean("launchBrowserOrMaps", false)) {
                       launchApp(context, url, title, sel);
                   } else {
                       generateNotification(context, url, title);
                   }
               } else {
                   Log.w(TAG, "Invalid URL: " + url);
               }
           }
       }
   }

   private void launchApp(Context context, String url, String title, String sel) {
       playNotificationSound(context);

       // Special handling for phone numbers
       String number = parseTelephoneNumber(sel);
       if (number != null) {
           try {
               Intent intent = new Intent("android.intent.action.DIAL",
                       Uri.parse("tel:" + number));
               intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
               startActivity(intent);
               return;
           } catch (ActivityNotFoundException e) {
               Log.w(TAG, "Dialer did not recognize " + sel);
           }
       }

       // Handling for URLs
       final String GMM_PACKAGE_NAME = "com.google.android.apps.maps";
       final String GMM_CLASS_NAME = "com.google.android.maps.MapsActivity";
       boolean isMapsURL = url.startsWith("http://maps.google.") ||
               url.matches("^http://www\\.google\\.[a-z\\.]+/maps");
       try {
           Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
           intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
           if (isMapsURL) {
               intent.setClassName(GMM_PACKAGE_NAME, GMM_CLASS_NAME);
           }
           context.startActivity(intent);
       } catch (ActivityNotFoundException e) {
           if (isMapsURL) {  // try again without GMM
               Log.w(TAG, "Maps not found, falling back to browser");
               Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
               intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
               context.startActivity(intent);
           }
       }
   }

   private String parseTelephoneNumber(String sel) {
       String number = null;
       if (sel != null && sel.matches("^([Tt]el[:]?)?\\s?[+]?(\\(?[0-9|\\s|-]\\)?)+$")) {
           String elements[] = sel.split("([Tt]el[:]?)");
           number = elements.length > 1 ? elements[1] : elements[0];
       }
       return number;
   }

   private void generateNotification(Context context, String url, String title) {
       int icon = R.drawable.status_icon;
       long when = System.currentTimeMillis();

       Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
       PendingIntent contentIntent = PendingIntent.getActivity(context, 0, intent, 0);

       Notification notification = new Notification(icon, title, when);
       notification.setLatestEventInfo(context, title, url, contentIntent);
       notification.defaults = Notification.DEFAULT_SOUND;
       notification.flags |= Notification.FLAG_AUTO_CANCEL;

       SharedPreferences settings = Prefs.get(context);
       int notificatonID = settings.getInt("notificationID", 0); // allow multiple notifications

       NotificationManager nm =
               (NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
       nm.notify(notificatonID, notification);

       SharedPreferences.Editor editor = settings.edit();
       editor.putInt("notificationID", ++notificatonID % 32);
       editor.commit();
   }

   private void playNotificationSound(Context context) {
       Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
       if (uri != null) {
           Ringtone rt = RingtoneManager.getRingtone(context, uri);
           if (rt != null) rt.play();
       }
   }
}
