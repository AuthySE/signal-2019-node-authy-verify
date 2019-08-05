const CONFIG = require('./CONFIG.js');
const ERRORS = require('./errors.js');


const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const adapter = new FileSync('db.json');
const db = low(adapter);

let dbTemplate = {
    "cc": "",
    "pn": "",
    "authyid": "",
    "password": "",
    "email": ""
};


const authy = require('authy')(CONFIG.DEMO_AUTHY_API_KEY);
const lookup = require('./lookup')(CONFIG.TWILIO_ACCT_SID,CONFIG.TWILIO_AUTH_TOKEN);
const verify = require('./verify')(CONFIG.TWILIO_ACCT_SID,CONFIG.TWILIO_AUTH_TOKEN,CONFIG.SERVICE_SID);

/**
 * Hash the password.
 * For demo purposes, we'll just change the password to "pass" and authenticate that.
 *
 * @param pwd
 * @returns {string}
 */
function hashPW (pwd) {
    // return crypto.createHash('sha256').update(pwd).digest('base64').toString();
    // for workshop/demo purposes, lets just set the password as "pass" instead.
    return "pass";
}

/**
 * Get user information from JSON db.
 *
 * @param username
 * @returns {boolean|Object}
 */
function getUser(username) {

    console.log("getuser: ", username);
    let user = db.get("users." + username).value();

    if(user){
        return user;
    } else {
        console.error(ERRORS.UserNotFound);
        return false;
    }
}


/**
 * Login a user
 * @param req
 * @param res
 */
exports.login = function (req, res) {

    let user = getUser(req.body.username);

    if (!user) {
        res.status(500).json(ERRORS.UserNotFound);
    } else if (('password' in req.body) && (user.password !== hashPW(req.body.password.toString()))) {

    } else {
        createSession(req, res, req.body.username);
    }
};

/**
 * Logout a user
 *
 * @param req
 * @param res
 */
exports.logout = function (req, res) {
    req.session.destroy(function (err) {
        if (err) {
            console.error(ERRORS.LogoutError);
            return next(err);
        }
        res.status(200).send();
    });
};


/**
 * Check user login status.  Redirect appropriately.
 *
 * @param req
 * @param res
 */
exports.loggedIn = function (req, res) {

    if (req.session.loggedIn && req.session.authy) {
        res.status(200).json({url: "/protected"});
    } else if (req.session.loggedIn && !req.session.authy) {
        res.status(200).json({url: "/2fa"});
    } else {
        res.status(200).json({url: "/login"});
    }
};


/**
 * Sign up a new user.
 *
 * @param req
 * @param res
 */
exports.register = function (req, res) {

    let username = req.body.username;
    let user = getUser(username);

    if (user) {
        res.status(409).json({error: ERRORS.UsernameTaken});
        return;
    }

    console.log("register ", user);

    db.set('users.' + username, dbTemplate).write();
    db.set('users.' + username + '.' + 'password', hashPW(req.body.password)).write();
    db.set('users.' + username + '.' + 'email', req.body.email).write();
    db.set('users.' + username + '.' + 'cc', req.body.country_code).write();
    db.set('users.' + username + '.' + 'pn', req.body.phone_number).write();

    authy.register_user(req.body.email, req.body.phone_number, req.body.country_code,

        function (err, regRes) {
            if (err) {
                console.error(ERRORS.ErrorRegistering, err);
                res.status(500).json({error: ERRORS.ErrorRegistering});
                return;
            }

            db.set('users.' + username + '.authyid', regRes.user.id).write();
            createSession(req, res, req.body.username);

        });
};

/**
 * Request a OneCode via SMS
 *
 * @param req
 * @param res
 */
exports.sms = function (req, res) {

    let user = getUser(req.session.username);
    console.log(user);
    if (!user) {
        console.error(ERRORS.SendAuthySMSError);
        res.status(500).json({error: ERRORS.SendAuthySMSError});
        return;
    }

    /**
     * If the user has the Authy app installed, it'll send a text
     * to open the Authy app to the TOTP token for this particular app.
     *
     * Passing force: true forces an SMS send.
     */
    authy.request_sms(user.authyid, true, function (err, smsRes) {
        if (err) {
            console.error(ERRORS.SendAuthySMSError, err);
            res.status(500).json(err);
            return;
        }
        console.log("Authy SMS response: ", smsRes);
        res.status(200).json(smsRes);
    });
};

/**
 * Request a OneCode via a voice call
 *
 * @param req
 * @param res
 */
exports.voice = function (req, res) {
    let user = getUser(req.session.username);

    if (!user) {
        console.error(ERRORS.SendAuthySMSError);
        res.status(500).json({error: ERRORS.UserNotFound});
        return;
    }

    /**
     * If the user has the Authy app installed, it'll send a text
     * to open the Authy app to the TOTP token for this particular app.
     *
     * Passing force: true forces an voice call to be made
     */
    authy.request_call(user.authyid, true, function (err, callRes) {
        if (err) {
            console.error(ERRORS.SendAuthyCallError, err);
            res.status(500).json(err);
            return;
        }
        console.log("AuthY Call response: ", callRes);
        res.status(200).json(callRes);
    });
};

/**
 * Verify an Authy Code
 *
 * @param req
 * @param res
 */
exports.verify = function (req, res) {
    let user = getUser(req.session.username);

    console.log("Verify Token");
    if (!user) {
        res.status(500).json({error: 'Verify-Authy-Token-Error'});
    }

    authy.verify(user.authyid, req.body.token, function (err, tokenRes) {
        if (err) {
            console.error(ERRORS.VerifyTokenError, err);
            res.status(500).json(err);
            return;
        }
        console.log("Verify Token Response: ", tokenRes);
        if (tokenRes.success) {
            req.session.authy = true;
        }
        res.status(200).json(tokenRes);
    });
};

/**
 * Create a Push Notification request.
 * The front-end client will poll 12 times at a frequency of 5 seconds before terminating.
 * If the status is changed to approved, it quit polling and process the user.
 *
 * @param req
 * @param res
 */
exports.createonetouch = function (req, res) {

    let user = getUser(req.session.username);

    if (!user) {
        console.error(ERRORS.FetchUserError);
        res.status(500).json({error: 'Create OneTouch User Error'});
    }

    let user_payload = {'message': 'Customize this push notification with your messaging'};

    authy.send_approval_request(user.authyid, user_payload, {}, null, function (oneTouchErr, oneTouchRes) {
        if (oneTouchErr) {
            console.error(ERRORS.CreateOneTouchError, oneTouchErr);
            res.status(500).json(oneTouchErr);
            return;
        }
        console.log("Created OneTouch Response", oneTouchRes);
        req.session.uuid = oneTouchRes.approval_request.uuid;
        res.status(200).json(oneTouchRes)
    });
};

/**
 * Poll for the OneTouch status.  Return the response to the client.
 * Set the user session 'authy' variable to true if authenticated.
 *
 * @param req
 * @param res
 */
exports.checkonetouchstatus = function (req, res) {

    let options = {
        url: "https://api.authy.com/onetouch/json/approval_requests/" + req.session.uuid,
        form: {
            "api_key": CONFIG.API_KEY
        },
        headers: {},
        qs: {
            "api_key": CONFIG.API_KEY
        },
        json: true,
        jar: false,
        strictSSL: true
    };

    authy.check_approval_status(req.session.uuid, function (err, response) {
        if (err) {
            console.error(ERRORS.PollOneTouchError, err);
            res.status(500).json(err);
        }
        console.log("OneTouch Status Response: ", response);
        if (response.approval_request.status === "approved") {
            req.session.authy = true;
        }
        res.status(200).json(response);
    });
};

/**
 * Register a phone
 *
 * @param req
 * @param res
 */
exports.requestPhoneVerification = function (req, res) {

    let phone_number = req.body.phone_number;
    let country_code = req.body.country_code;
    let via = req.body.via;
    let locale = req.body.locale;

    if (phone_number && country_code && via && locale) {
        let e164 = "+" + country_code + phone_number;
        verify.createVerify(e164, locale, via, function (response) {
            if (response) {
                console.log('success creating verify v2 call', response);
                res.status(200).json({});
            } else {
                console.error(ERRORS.VerifyStartError, response);
                res.status(500).json(response);
            }
        });
    } else {
        console.error(ERRORS.MissingFields, req.body);
        res.status(500).json({error: ERRORS.MissingFields});
    }
};


/**
 * Confirm a phone registration token
 *
 * @param req
 * @param res
 */
exports.verifyPhoneToken = function (req, res) {

    let country_code = req.body.country_code;
    let phone_number = req.body.phone_number;
    let token = req.body.token;

    if (phone_number && country_code && token) {

        let e164 = "+" + country_code + phone_number;

        verify.checkVerify(e164, token, function (response) {
            if (response.valid) {
                console.log('Confirm phone success confirming code: ', response);
                req.session.ph_verified = true;
                res.status(200).json({});
            } else {
                console.error(ERRORS.VerifyTokenError, response);
                res.status(500).json({});
            }
        });

    } else {
        console.error(ERRORS.MissingFields, req.body);
        res.status(500).json({error: ERRORS.MissingFields});
    }
};

/**
 * Lookup a phone number
 * @param req
 * @param res
 */
exports.lookupNumber = function (req, res) {

    let country_code = req.body.country_code;
    let phone_number = req.body.phone_number;

    if(country_code && phone_number){
        lookup.get(phone_number,country_code, function(resp){
            if(resp === false){
                res.status(500).send({"success": false});
            } else {
                console.log("Successful Lookup Response:", resp);
                res.json({info: resp})
            }
        });

    } else {
        console.error(ERRORS.MissingFields, req.body);
        res.status(500).json({error: ERRORS.MissingFields});
    }
};


/**
 * Create the initial user session.
 *
 * @param req
 * @param res
 * @param username
 */
function createSession (req, res, username) {
    req.session.regenerate(function () {
        req.session.loggedIn = true;
        req.session.user = username;
        req.session.username = username;
        req.session.msg = 'Authenticated as: ' + username;
        req.session.authy = false;
        req.session.ph_verified = false;
        res.status(200).json();
    });
}