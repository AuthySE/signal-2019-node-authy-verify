const express = require('express');

const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const expressSession = require('express-session');

const config = require('./server/config.js');

const app = express();
const server = require('http').Server(app);

if(!config.DEMO_AUTHY_API_KEY){
    console.log("Please set your DEMO_AUTHY_API_KEY environment variable before proceeding.");
    process.exit(1);
}


app.use(cookieParser());
app.use(expressSession({'secret': config.SECRET}));

app.use(bodyParser.json({}));
app.use(bodyParser.urlencoded({
    extended: true
}));

const router = express.Router();
const actions = require('./server/controller.js');

router.route('/user/register').post(actions.register);

router.route('/logout').get(actions.logout);
router.route('/login').post(actions.login);

/**
 * Authy Authentication API
 */
router.route('/authy/sms').post(actions.sms);
router.route('/authy/voice').post(actions.voice);
router.route('/authy/verify').post(actions.verify);
router.route('/authy/onetouchstatus').post(actions.checkonetouchstatus);
router.route('/authy/onetouch').post(actions.createonetouch);

router.route('/loggedIn').post(actions.loggedIn);

/**
 * Authy Phone Verification API
 */
router.route('/verification/start').post(actions.requestPhoneVerification);
router.route('/verification/verify').post(actions.verifyPhoneToken);

/**
 * Lookups
 */
router.route('/lookup').post(actions.lookupNumber);

/**
 * Require user to be logged in and authenticated with 2FA
 *
 * @param req
 * @param res
 * @param next
 */
function requirePhoneVerification(req, res, next) {
    if (req.session.ph_verified) {
        console.log("Phone Verified");
        next();
    } else {
        console.log("Phone Not Verified");
        res.redirect("/verification");
    }
}
/**
 * Require user to be logged in and authenticated with 2FA
 *
 * @param req
 * @param res
 * @param next
 */
function requireLoginAnd2FA(req, res, next) {
    if (req.session.loggedIn && req.session.authy) {
        console.log("RL2FA:  User logged and 2FA");
        next();
    } else if (req.session.loggedIn && !req.session.authy) {
        console.log("RL2FA:  User logged in but no 2FA");
        res.redirect("/2fa");
    } else {
        console.log("RL2FA:  User not logged in.  Redirecting.");
        res.redirect("/login");
    }
}

/**
 * Require user to be logged in.
 *
 * @param req
 * @param res
 * @param next
 */
function requireLogin(req, res, next) {
    if (req.session.loggedIn) {
        console.log("RL:  User logged in");
        next();
    } else {
        console.log("RL:  User not logged in.  Redirecting.");
        res.redirect("/login");
    }
}

/**
 * Test for 200 response.  Useful when setting up Authy callback.
 */
router.route('/test').post(function(req, res){
    return res.status(200).send({"connected": true});
});

/**
 * All pages under protected require the user to be both logged in and authenticated via 2FA
 */
app.all('/protected/*', requireLoginAnd2FA, function (req, res, next) {
    next();
});

/**
 * Require user to be logged in to view 2FA page.
 */
app.all('/2fa/*', requireLogin, function (req, res, next) {
    next();
});

/**
 * Prefix all router calls with 'api'
 */
app.use('/api', router);
app.use('/', express.static(__dirname + '/public'));

// Start the server.
console.log('Server starting, localhost:' + config.PORT);
server.listen(config.PORT);