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
import java.net.URI;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;

import org.apache.http.Header;
import org.apache.http.HttpResponse;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.params.HttpClientParams;
import org.apache.http.impl.client.DefaultHttpClient;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.params.BasicHttpParams;
import org.apache.http.params.HttpParams;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.accounts.AccountManagerFuture;
import android.accounts.AuthenticatorException;
import android.accounts.OperationCanceledException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;

/**
 * Register with the chrometophone appengine server.
 * Will pass the registration id and user, authenticating with app engine.
 */
public class DeviceRegistrar {
    private static final String TAG = "DeviceRegistrar";
    static final String SENDER_ID = "stp.chrome@gmail.com";
    static final String BASE_URL = "https://chrometophone.appspot.com";

    // Appengine authentication
    private static final String AUTH_URL = BASE_URL + "/_ah/login";
    private static final String AUTH_TOKEN_TYPE = "ah";

    private static final String REGISTER_URL = BASE_URL + "/register";
    private static final String UNREGISTER_URL = BASE_URL + "/unregister";

    public static void registerWithServer(final Context context,
          final String deviceRegistrationID) {
        new Thread(new Runnable() {
            public void run() {
                try {
                    HttpResponse res = makeRequest(context, deviceRegistrationID, REGISTER_URL);
                    if (res.getStatusLine().getStatusCode() == 200) {
                        SharedPreferences settings = Prefs.get(context);
                        SharedPreferences.Editor editor = settings.edit();
                        editor.putString("deviceRegistrationID", deviceRegistrationID);
                        editor.commit();
                    } else {
                        Log.w(TAG, "Registration error " +
                                String.valueOf(res.getStatusLine().getStatusCode()));
                    }
                    context.sendBroadcast(new Intent("com.google.ctp.UPDATE_UI"));
                } catch (PendingAuthException e) {
                    // Ignore - we'll reregister later
                } catch (Exception e) {
                    Log.w(TAG, "Registration error " + e.getMessage());
                    context.sendBroadcast(new Intent("com.google.ctp.UPDATE_UI"));
                }
            }
        }).start();
    }

    public static void unregisterWithServer(final Context context,
            final String deviceRegistrationID) {
        try {
            HttpResponse res = makeRequest(context, deviceRegistrationID, UNREGISTER_URL);
            if (res.getStatusLine().getStatusCode() == 200) {
                SharedPreferences settings = Prefs.get(context);
                SharedPreferences.Editor editor = settings.edit();
                editor.remove("deviceRegistrationID");
                editor.commit();
            } else {
                Log.w(TAG, "Unregistration error " +
                        String.valueOf(res.getStatusLine().getStatusCode()));
            }
        } catch (Exception e) {
            Log.w(TAG, "Unegistration error " + e.getMessage());
        }

        // Update dialog activity
        context.sendBroadcast(new Intent("com.google.ctp.UPDATE_UI"));
    }

    private static HttpResponse makeRequest(Context context, String deviceRegistrationID,
            String url) throws Exception {
        HttpResponse res = makeRequestNoRetry(context, deviceRegistrationID, url,
                false);
        if (res.getStatusLine().getStatusCode() == 500) {
            res = makeRequestNoRetry(context, deviceRegistrationID, url,
                    true);
        }
        return res;
    }

    private static HttpResponse makeRequestNoRetry(Context context, String deviceRegistrationID,
            String url, boolean newToken) throws Exception {
        // Get chosen user account
        SharedPreferences settings = Prefs.get(context);
        String accountName = settings.getString("accountName", null);
        if (accountName == null) throw new Exception("No account");

        // Get auth token for account
        Account account = new Account(accountName, "com.google");
        String authToken = getAuthToken(context, account);
        if (authToken == null) {
            throw new PendingAuthException(accountName);
        }
        if (newToken) {
            // Invalidate the cached token
            AccountManager accountManager = AccountManager.get(context);
            accountManager.invalidateAuthToken(account.type, authToken);
            authToken = getAuthToken(context, account);
        }

        // Register device with server
        DefaultHttpClient client = new DefaultHttpClient();
        String continueURL = BASE_URL;

        URI uri = new URI(AUTH_URL + "?continue=" +
                URLEncoder.encode(continueURL, "UTF-8") +
                "&auth=" + authToken);
        HttpGet method = new HttpGet(uri);
        // No redirect following - continue is not used
        final HttpParams params = new BasicHttpParams();
        HttpClientParams.setRedirecting(params, false);
        method.setParams(params);

        HttpResponse res = client.execute(method);
        Header[] headers = res.getHeaders("Set-Cookie");
        if (res.getStatusLine().getStatusCode() != 302 ||
                headers.length == 0) {
            return res;
        }
        String ascidCookie = null;
        for (Header header: headers) {
            if (header.getValue().indexOf("ACSID=") >=0) {
                // let's parse it
                String value = header.getValue();
                String[] pairs = value.split(";");
                ascidCookie = pairs[0];
            }
        }

        uri = new URI(url);
        HttpPost post = new HttpPost(uri);
        List<NameValuePair> formparams = new ArrayList<NameValuePair>();
        formparams.add(new BasicNameValuePair("devregid", deviceRegistrationID));
        UrlEncodedFormEntity entity =
            new UrlEncodedFormEntity(formparams, "UTF-8");
        post.setEntity(entity);
        post.setHeader("Cookie", ascidCookie);
        post.setHeader("X-Same-Domain", "1");  // XSRF
        res = client.execute(post);
        return res;
    }

    private static String getAuthToken(Context context, Account account) {
        String authToken = null;
        AccountManager accountManager = AccountManager.get(context);
        try {
            AccountManagerFuture<Bundle> future =
                    accountManager.getAuthToken (account, AUTH_TOKEN_TYPE, false, null, null);
            Bundle bundle = future.getResult();
            authToken = bundle.getString(AccountManager.KEY_AUTHTOKEN);
            // User will be asked for "App Engine" permission.
            if (authToken == null) {
                // No auth token - will need to ask permission from user.
                Intent intent = new Intent(MainActivity.AUTH_PERMISSION_ACTION);
                intent.putExtra("AccountManagerBundle", bundle);
                context.sendBroadcast(intent);
            }
        } catch (OperationCanceledException e) {
            Log.w(TAG, e.getMessage());
        } catch (AuthenticatorException e) {
            Log.w(TAG, e.getMessage());
        } catch (IOException e) {
            Log.w(TAG, e.getMessage());
        }
        return authToken;
    }

    static class PendingAuthException extends Exception {
        private static final long serialVersionUID = 1L;

        public PendingAuthException(String message) {
            super(message);
        }
    }
}
