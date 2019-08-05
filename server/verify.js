const request = require('request');
const VERSION = "0.1";

module.exports = function (SID, AUTH_TOKEN, SERVICE_SID) {
	return new Verify(SID, AUTH_TOKEN, SERVICE_SID);
};

function Verify(SID, AUTH_TOKEN, SERVICE_SID) {
	this.SID = SID;
	this.AUTH_TOKEN = AUTH_TOKEN;
	this.SERVICE_SID = SERVICE_SID;
	this.URL = "https://verify.twilio.com";
	this.headers = {};
    this.SETUP = false;
	this.init();
}

Verify.prototype.init = function () {

    if(!this.SID || !this.AUTH_TOKEN || !this.SERVICE_SID){
        console.error("Account SID, Verify v2 Service SID, and Auth Token required for Verification");
    } else {
        this.SETUP = true;
        this.headers = {
            "Authorization": "Basic " + new Buffer(this.SID + ":" + this.AUTH_TOKEN).toString("base64")
        };
        console.log("Verify v2 setup properly");
    }
};

/**
 * Verify a number.
 *
 */

// curl 'https://verify.twilio.com/v2/Services/VA0f47743cd2a2c5a1c69ff0566d63bbde/Verifications' -X POST \
// --data-urlencode 'To=+18439011978' \
// --data-urlencode 'Channel=sms' \
// -u AC18967c4e46e7c1b3baf783fdae3aab2e:[AuthToken]


Verify.prototype.createVerify = function (phone_number, locale, via, callback) {

    let form = {
        "To": phone_number,
        "Channel": via,
		"Locale": locale
    };

    if(!this.SETUP){
        console.log('Verify was not setup properly.');
        callback(false);
    } else {
        this._request("post", "/v2/Services/" + this.SERVICE_SID + "/Verifications", form,
            callback
        );
    }
};


// curl 'https://verify.twilio.com/v2/Services/VA0f47743cd2a2c5a1c69ff0566d63bbde/VerificationCheck' -X POST \
// --data-urlencode 'Code=12345' \
// --data-urlencode 'To=+18439011978' \
// -u AC18967c4e46e7c1b3baf783fdae3aab2e:[AuthToken]

Verify.prototype.checkVerify = function (phone_number, code, callback) {


    let form = {
        "Code": code,
        "To": phone_number
    };

    if(!this.SETUP){
        console.log('Verify was not setup properly.');
        callback(false);
    } else {
        this._request("post", "/v2/Services/" + this.SERVICE_SID + "/VerificationCheck", form,
            callback
        );
    }
};


Verify.prototype._request = function (type, path, params, callback, qs) {

	let options = {
		url: this.URL + path,
		form: params,
		headers: this.headers,
		qs: qs,
		json: true,
		jar: false,
		strictSSL: true
	};

	let callback_check = function (err, res, body) {

		if (!err) {
			if (res.statusCode === 200 || res.statusCode === 201) {
				callback(body);
			} else {
				callback(false);
			}
		} else {
			console.log('callback error');
			callback(err);
		}
	};

	switch (type) {
		case "post":
			request.post(options, callback_check);
			break;

		case "get":
			request.get(options, callback_check);
			break;
	}
};