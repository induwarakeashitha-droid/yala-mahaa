const jwt = require('jsonwebtoken')

function requireFarmer(req, res, next) {
    const tok = req.headers.authorization?.split(" ")[ 1 ]

    if (!tok) {
        return res.status(401).json({ status: "error", message: "token not found" })
    }

// checks the farmer's access token signature + expiry, then puts their id on req
    try {
        const dec = jwt.verify(tok, process.env.JWT_SECRET)
        req.farmerId = dec.id
        req.sessionId = dec.sessionId
        return next()
    } catch {
        return res.status(401).json({ status: "error", message: "token invalid or expired" })
    }
}

module.exports = requireFarmer
