#!/usr/bin/env node

var _     = require("lodash"),
    util  = require('util'),
    spawn = require('child_process').spawn,
    exec  = require('child_process').exec,
    fs    = require("fs"),
    p     = require("path"),
    ansi  = require("ansi"),
    cursor = ansi(process.stdout),
    program = require("commander"),
    projectConfig;

program
    .version('0.0.1')
    .option('-c, --config [file]', 'optional custom config file', "projects.json")
    .option('-v, --verbose', 'display verbose information');

// colorize the console output
var oldError = console.error,
    oldInfo = console.info;

console.error = function() {
    cursor.brightRed();
    oldError.apply(this, ['error:'].concat(Array.prototype.slice.apply(arguments)));
    cursor.reset();
};
console.info = function() {
    cursor.brightCyan();
    oldInfo.apply(this, ['info:'].concat(Array.prototype.slice.apply(arguments)));
    cursor.reset();
};
console.success = function() {
    cursor.green();
    console.log.apply(this, ['success:'].concat(Array.prototype.slice.apply(arguments)));
    cursor.reset();
};

function readConfig(file) {
    var files = _.map(
        [ process.cwd(), process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'] ],
        function (path) {
            return p.join(path, file);
        }),
        data;

    for (var i = 0, ln = files.length; i < ln; i += 1) {
        try {
            data = fs.readFileSync(files[i]);
            break;
        } catch (err) { }
    }

    if (data) {
        return JSON.parse(data);
    } else {
        throw new Error('Unable to find configuration file in ' + files.join(', '));
    }
}

// write out the config file to the file specified (by options)
function writeConfig() {
    fs.writeFile(program.config, JSON.stringify(projectConfig, null, 4), function(err) {
        if(err) {
            console.error("Failed to write file: ", program.config);
        }

        if(program.verbose) {
            console.success("Wrote config to file: " + program.config);
        }
    });
}

// create a sample config file
function sampleConfig() {
    projectConfig = {
        "project A": {
            url: "https://subversion.example.com/repo/trunk",
            notes: "replace me!"
        }
    };

    writeConfig();
}

program.on('generate.infoComplete', function(config) {
    projectConfig = config;
    writeConfig();
});

// generate config out of existing repositories
function generateConfig() {
    var dirs = [],
        svnPaths = [],
        files,
        config = {},
        infoCount = 0,
        totalInfos = 0;

    // attempt to divine svn projects from cwd

    // pick out all the directories
    files = fs.readdirSync(process.cwd());
    _.each(files, function(file) {
        if(fs.statSync(file).isDirectory()) {
            dirs.push(file);
        }
    });

    // pick out all the directories that appear to be svn repos
    _.each(dirs, function(d) {
        var sPath = p.join(process.cwd(), d);
        files = fs.readdirSync(sPath);
        _.each(files, function(file) {
            if(file === '.svn') {
                svnPaths.push(sPath);
            }
        });
    });

    // gather svn info for each
    totalInfos = svnPaths.length;

    _.each(svnPaths, function(dir) {
        var info = spawn('svn', ['info'], {cwd: dir});

        info.stdout.on('data', function(data) {
            // parse the info and add to config
            console.log(dir + " ::: " + data);
        });

        info.on('exit', function(code) {
            infoCount += 1;

            if(infoCount === totalInfos) {
                program.emit("generate.infoComplete", config);
            }
        });
    });
}

function checkout(repo) {
    var ck = spawn('svn', ['checkout', repo.url, repo.name]);

    if(program.verbose) {
        ck.stdout.on('data', function(data) {
            console.info(repo + ": " + data);
        });
    }
}

function info(repo) {
    var inf = spawn('svn', ['info'], {cwd: p.join(process.cwd(), repo.name)}),
        output = "",
        success = true;

    inf.stdout.on('data', function(data) {
        output += data;
    });

    inf.stderr.on('data', function(data) {
        console.error(repo + ': ' + data);
        success = false;
    });

    inf.on('exit', function(code) {
        if(success) {
            console.info(repo.name + ": " + output + "\n\n");
        } else {
            console.error(repo.name + ' failed');
        }
    });
}

function update(repo, workingDir) {
    var up = spawn('svn', ['update'], {cwd: workingDir}),
        success = true;

    if(program.verbose) {
        up.stdout.on('data', function (data) {
            console.info(repo + ": " + data);
        });
    }

    up.stderr.on('data', function (data) {
        console.error(repo + ': ' + data);
        success = false;
    });

    up.on('exit', function (code) {
        if(success) {
            console.success(repo + ": updated successfully.");
        } else {
            console.error(repo + ": failed to update!");
        }
    });
}

function bulkInfo() {
    _.each(projectConfig, function(repo, name) {
        repo.name = name;
        info(repo);
    });
}

function bulkUpdate() {
    _.each(projectConfig, function(repo, name) {
        update(name, p.join(process.cwd(), name));
    });
}

function bulkCheckout() {
    _.each(projectConfig, function(repo, name) {
        repo.name = name;
        checkout(repo);
    });
}

function printConfig() {
    if(program.verbose) {
        console.info(JSON.stringify(projectConfig, null, 4));
    } else {
        _.each(projectConfig, function(repo, name) {
            console.info("+ " + name);
        });
    }
}

function loadConfig() {
    try {
        projectConfig = readConfig(program.config);
    } catch(e) {
        console.error(e);
        process.exit();
    }
}

program
    .command("list")
    .description("list projects")
    .action(loadConfig)
    .action(printConfig);

program
    .command("info")
    .description("get the source control info")
    .action(loadConfig)
    .action(bulkInfo);

program
    .command("generate [sample]")
    .description("generate a config file in cwd")
    .action(function(sample) {
        if(sample) {
            sampleConfig();
        } else {
            generateConfig();
        }
    });

program
    .command("update")
    .description("update repositories")
    .action(loadConfig)
    .action(bulkUpdate);

program
    .command("init")
    .description("initialize projects (svn checkout)")
    .action(loadConfig)
    .action(bulkCheckout);

program.parse(process.argv);