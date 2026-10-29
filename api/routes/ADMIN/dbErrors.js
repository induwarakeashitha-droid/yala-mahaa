// postgres errors caused by bad input -> 400/409, rest goes to the error handler
const CLIENT_ERRORS = {
  '23505': [409, 'A row with that value already exists.'],          // unique
  '23503': [409, 'This refers to a row that does not exist, or is still used by other rows.'], // fk
  '23502': [400, 'A required value is missing.'],                    // not null
  '23514': [400, 'A value is not allowed by a table rule.'],         // check
  '22P02': [400, 'A value has the wrong format.'],
  '22003': [400, 'A number is out of range.'],
  '22007': [400, 'A date has the wrong format.'],
  '22008': [400, 'A date is out of range.'],
  '22001': [400, 'A text value is too long.'],
  '428C9': [400, 'That column is filled in by the database and cannot be set.'] // generated always
}

function sendDbError(res, next, err){
  const known = CLIENT_ERRORS[err.code]
  if(!known) return next(err)
  const [status, message] = known
  return res.status(status).json({
    status: 'fail',
    message,
    detail: err.detail || err.message,
    constraint: err.constraint,
    column: err.column
  })
}

module.exports = { sendDbError }
