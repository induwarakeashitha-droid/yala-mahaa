// everything under /admin
const express = require('express')
const { requireAdmin, canEdit } = require('../../middleware/requireAdmin.js')
const adminauthrouter = require('./authroutes.js')
const farmerrouter = require('./farmerroutes.js')
const dbrouter = require('./dbroutes.js')
const smsrouter = require('./alertroutes.js')
const datarouter = require('./dataroutes.js')
const adminreportrouter = require('./reportroutes.js')

const adminrouter =express.Router()


adminrouter.use('/auth', adminauthrouter)
adminrouter.use('/farmers', requireAdmin, farmerrouter)
adminrouter.use('/db',requireAdmin, dbrouter)     //admin auth middleware
adminrouter.use('/data', requireAdmin, datarouter)
adminrouter.use('/reports', requireAdmin, adminreportrouter)

// officers can read sms history but not send
adminrouter.use('/sms', requireAdmin, (req, res, next) => (req.method === 'GET' ? next() : canEdit(req, res, next)), smsrouter)


adminrouter.use((req, res) => res.status(404).json({ status: 'fail', message: 'Not found.' }))

module.exports = adminrouter
