/** Copyright © 2016, Okta, Inc.
 * 
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

// Dependencies
var express = require('express');
var app = express();
var sqlite3 = require('sqlite3').verbose();
var url = require('url');
var uuid = require('uuid');
var bodyParser = require('body-parser');
var morgan = require('morgan')


var db = new sqlite3.Database('test.db');

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('combined'))
app.use('/healthcheck', require('express-healthcheck')({
  test: function () {
    db.get("PRAGMA table_info('Users')", (err, row) => {
      if (err != null) {
        throw Error(err);
      }
    });
  }
}));


/** 
 *   Constructor for creating SCIM Resource 
 */
function GetSCIMList(rows, startIndex, count, req_url) {
  var scim_resource = {
    "Resources": [],
    "itemsPerPage": 0,
    "schemas": [
      "urn:ietf:params:scim:api:messages:2.0:ListResponse"
    ],
    "startIndex": 0,
    "totalResults": 0
  }

  var resources = [];
  var location = ""
  for (var i = (startIndex - 1); i < count; i++) {
    location = req_url + "/" + rows[i]["id"];
    var userResource = GetSCIMUserResource(
      rows[i]["id"],
      rows[i]["active"],
      rows[i]["userName"],
      rows[i]["givenName"],
      rows[i]["middleName"],
      rows[i]["familyName"],
      location);
    resources.push(userResource);
    location = "";
  }

  scim_resource["Resources"] = resources;
  scim_resource["startIndex"] = startIndex;
  scim_resource["itemsPerPage"] = count;
  scim_resource["totalResults"] = count

  return scim_resource;
}

/**
 *  Returns JSON dictionary of SCIM response
 */
function GetSCIMUserResource(userId, active, userName,
  givenName, middleName, familyName, req_url) {

  var scim_user = {
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
    "id": null,
    "userName": null,
    "name": {
      "givenName": null,
      "middleName": null,
      "familyName": null,
    },
    "active": false,
    "meta": {
      "resourceType": "User",
      "location": null,
    }
  };

  scim_user["meta"]["location"] = req_url;
  scim_user["id"] = userId;
  scim_user["active"] = active;
  scim_user["userName"] = userName;
  scim_user["name"]["givenName"] = givenName;
  scim_user["name"]["middleName"] = middleName;
  scim_user["name"]["familyName"] = familyName;

  return scim_user;

}

/**
 *  Returns an error message and status code
 */
function SCIMError(errorMessage, statusCode) {
  var scim_error = {
    "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
    "detail": null,
    "status": null
  }

  scim_error["detail"] = errorMessage;
  scim_error["status"] = statusCode;

  return scim_error;
}

/**
 *  Creates a new User with given attributes
 */
app.post('/scim/v2/Users', function (req, res) {
  console.log("> POST /scim/v2/Users");
  var url_parts = url.parse(req.url, true);
  var req_url = url_parts.pathname;
  var requestBody = "";

  console.log("req_url=" + req_url);
  // requestBody += req.body;
  // console.log("requestBody=" + requestBody);
  // var userJsonData = JSON.parse(requestBody);
  var userJsonData = req.body;
  var active = userJsonData['active'];
  var userName = userJsonData['userName'];
  var givenName = userJsonData["name"]["givenName"];
  var middleName = userJsonData["name"]["middleName"];
  var familyName = userJsonData["name"]["familyName"];
  console.log("userName=" + userName);

  var usernameQuery = "SELECT * FROM Users WHERE userName='" + userName + "'";
  db.get(usernameQuery, function (err, rows) {
    if (err == null) {
      if (rows === undefined) {
        var userId = String(uuid.v1());
        var runQuery = `INSERT INTO 'Users' (id, active, userName, givenName, middleName, familyName) VALUES 
          ('${userId}','${active}','${userName}','${givenName}','${middleName}','${familyName}')`;
        db.run(runQuery, function (err) {
          if (err !== null) {
            var scim_error = SCIMError(String(err), "400");
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end(JSON.stringify(scim_error));
          } else {
            var scimUserResource = GetSCIMUserResource(userId, active, userName, givenName, middleName, familyName, req_url);

            res.writeHead(201, { 'Content-Type': 'text/json' });
            res.end(JSON.stringify(scimUserResource));
          }
        });
      } else {
        var scim_error = SCIMError("Conflict - Resource Already Exists", "409");
        res.writeHead(409, { 'Content-Type': 'text/plain' });
        res.end(JSON.stringify(scim_error));
      }
    } else {
      console.error(String(err));
      var scim_error = SCIMError(String(err), "400");
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(JSON.stringify(scim_error));
    }
  });
});

/**
 *  Return filtered Users stored in database
 *
 *  Pagination supported
 */
app.get("/scim/v2/Users", function (req, res) {
  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  startIndex = query["startIndex"];
  count = query["count"];
  filter = query["filter"];

  var req_url = url_parts.pathname;
  var selectQuery = "SELECT * FROM Users";
  var queryAtrribute = "";
  var queryValue = "";

  if (filter != undefined) {
    queryAtrribute = String(filter.split("eq")[0]).trim();
    queryValue = String(filter.split("eq")[1]).trim();
    selectQuery = "SELECT * FROM Users WHERE " + queryAtrribute + " = " + queryValue;
  }

  db.all(selectQuery, function (err, rows) {
    if (err == null) {
      if (rows === undefined) {
        var scim_error = SCIMError("User Not Found", "404");
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(JSON.stringify(scim_error));
      } else {
        // If requested no. of users is less than all users
        if (rows.length < count) {
          count = rows.length
        }

        var scimResource = GetSCIMList(rows, startIndex, count, req_url);
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(scimResource))
      }
    } else {
      var scim_error = SCIMError(String(err), "400");
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(JSON.stringify(scim_error));
    }
  });
});

/**
 *  Queries database for User with identifier
 *
 *  Updates response code with '404' if unable to locate User
 */
app.get("/scim/v2/Users/:userId", function (req, res) {
  var url_parts = url.parse(req.url, true);
  var query = url_parts.query;
  var userId = req.params.userId;

  startIndex = query["startIndex"]
  count = query["count"]
  var req_url = req.url;
  var queryById = "SELECT * FROM Users WHERE id='" + userId + "'";

  db.get(queryById, function (err, rows) {
    if (err == null) {
      if (rows === undefined) {
        var scim_error = SCIMError("User Not Found", "404");
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(JSON.stringify(scim_error));
      } else {
        var scimUserResource = GetSCIMUserResource(userId, rows.active, rows.userName,
          rows.givenName, rows.middleName, rows.familyName, req_url);
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(scimUserResource));
      }
    } else {
      var scim_error = SCIMError(String(err), "400");
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(JSON.stringify(scim_error));
    }
  });
});

/**
 *  Update User attributes via Patch
 */
app.patch("/scim/v2/Users/:userId", function (req, res) {

  var userId = req.params.userId;
  var url_parts = url.parse(req.url, true);
  var req_url = url_parts.pathname;

  var op = "";
  var value = "";
  var requestBody = "";
  req.on('data', function (data) {
    requestBody += data;

    var jsonReqBody = JSON.parse(requestBody);
    op = jsonReqBody["Operations"][0]["op"];
    value = jsonReqBody["Operations"][0]["value"];
    var attribute = Object.keys(value)[0];
    var attrValue = value[attribute];

    if (op == "replace") {
      var updateUsersQuery = "UPDATE 'Users' SET " + attribute + " = '"
        + attrValue + "'WHERE id = '" + String(userId) + "'";
      db.run(updateUsersQuery, function (err) {
        if (err == null) {
          var queryById = "SELECT * FROM Users WHERE id='" + userId + "'";

          db.get(queryById, function (err, rows) {
            if (err == null) {
              var scimUserResource = GetSCIMUserResource(userId, rows.active, rows.userName,
                rows.givenName, rows.middleName, rows.familyName, req_url);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(scimUserResource));
            } else {
              var scim_error = SCIMError(String(err), "400");
              res.writeHead(400, { 'Content-Type': 'application/text' });
              res.end(JSON.stringify(scim_error));
            }
          });
        } else {
          var scim_error = SCIMError(String(err), "400");
          res.writeHead(400, { 'Content-Type': 'application/text' });
          res.end(JSON.stringify(scim_error));
        }
      });
    } else {
      var scim_error = SCIMError("Operation Not Supported", "403");
      res.writeHead(403, { 'Content-Type': 'application/text' });
      res.end(JSON.stringify(scim_error));
    }
  });
});

/**
 *  Update User attributes via Patch
 */
app.put("/scim/v2/Users/:userId", function (req, res) {
  var userId = req.params.userId;
  var url_parts = url.parse(req.url, true);
  var req_url = url_parts.pathname;
  var requestBody = "";

  req.on('data', function (data) {
    requestBody += data;

    var userJsonData = JSON.parse(requestBody);
    var active = userJsonData['active'];
    var userName = userJsonData['userName'];
    var givenName = userJsonData["name"]["givenName"];
    var middleName = userJsonData["name"]["middleName"];
    var familyName = userJsonData["name"]["familyName"];
    var queryById = "SELECT * FROM Users WHERE id='" + userId + "'";

    db.get(queryById, function (err, rows) {
      if (err == null) {
        if (rows != undefined) {
          var updateUsersQuery = "UPDATE 'Users' SET userName = '" + String(userName)
            + "', givenName = '" + String(givenName) + "', middleName ='"
            + String(middleName) + "', familyName= '" + String(familyName)
            + "'   WHERE id = '" + userId + "'";

          db.run(updateUsersQuery, function (err) {
            if (err !== null) {
              var scim_error = SCIMError(String(err), "400");
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end(JSON.stringify(scim_error));
            } else {
              var scimUserResource = GetSCIMUserResource(userId, active, userName,
                givenName, middleName, familyName, req_url);
              res.writeHead(201, { 'Content-Type': 'text/json' });
              res.end(JSON.stringify(scimUserResource));
            }
          });
        } else {
          var scim_error = SCIMError("User Does Not Exist", "404");
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end(JSON.stringify(scim_error));
        }
      } else {
        var scim_error = SCIMError(String(err), "400");
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(JSON.stringify(scim_error));
      }
    });
  });
});

/**
 *  Default URL
 */
app.get('/scim/v2', function (req, res) { res.send('SCIM'); });

/**
 *  Instantiates or connects to DB
 */
var server = app.listen(process.env.PORT || 8080, function () {
  var databaseQuery = "SELECT name FROM sqlite_master WHERE type='table' \
                      AND name='Users'";
  db.get(databaseQuery, function (err, rows) {
    if (err !== null) { console.log(err); }
    else if (rows === undefined) {
      var createTable = 'CREATE TABLE Users ("id" primary key, \
                        "active" INTEGER,"userName" VARCHAR(255), \
                        "givenName" VARCHAR(255), "middleName" VARCHAR(255), \
                        "familyName" VARCHAR(255))';
      db.run(createTable, function (err) {
        if (err !== null) { console.log(err); }
      });
    }
  });
});



