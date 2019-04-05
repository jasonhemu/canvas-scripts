// ==UserScript==
// @name        Download Site Roster
// @description Generates a .CSV download of the site roster for all students
// @include     https://*.instructure.com/courses/*/users
// @require     https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/1.3.3/FileSaver.js
// @version     0.1
// @grant       none
// ==/UserScript==

(function() {
    'use strict';

    var studentArr = [];
    var pending = -1;
    var ajaxPool;
    var aborted = false;
    addButton();

    function addButton() {
        if ($('#site_roster').length === 0) {
            $('#people-options > ul').append(
                '<li class="ui-menu-item" role="presentation">'
                + '<a id="site_roster" class="ui-corner-all" role="menuitem" tabindex="-1" style="cursor: pointer;">'
                + '<i class="icon-collection-save"></i> Download Roster</a></li>');
            $('#site_roster').one('click', roster);
        }
        return;
    }

    function abortAll() {
        for (var i = 0; i < ajaxPool.length; i++) {
            ajaxPool[i].abort();
        }
        ajaxPool = [];
    }

    function setupPool() {
        try {
            ajaxPool = [];
            $.ajaxSetup({
                'beforeSend' : function(jqXHR) {
                    ajaxPool.push(jqXHR);
                },
                'complete' : function(jqXHR) {
                    var i = ajaxPool.indexOf(jqXHR);
                    if (i > -1) {
                        ajaxPool.splice(i, 1);
                    }
                }
            });
        } catch (e) {
            throw new Error('Error configuring AJAX pool');
        }
    }

    function getCourseId() {
        var courseId = null;
        try {
            var courseRegex = new RegExp('/courses/([0-9]+)');
            var matches = courseRegex.exec(window.location.href);
            if (matches) {
                courseId = matches[1];
            } else {
                throw new Error('Unable to detect Course ID');
            }
        } catch (e) {
            errorHandler(e);
        }
        return courseId;
    }

    function roster() {
        aborted = false;
        setupPool();
        var courseId = getCourseId();
        var url = '/api/v1/courses/' + courseId + '/users?enrollment_type%5b%5d=student&include%5b%5d=email&include%5b%5d=enrollments&per_page=100';
        progressbar();
        pending = 0;
        getRoster(courseId, url);
    }

    function nextURL(linkTxt) {
        var url = null;
        if (linkTxt) {
            var links = linkTxt.split(',');
            var nextRegEx = new RegExp('^<(.*)>; rel="next"$');
            for (var i = 0; i < links.length; i++) {
                var matches = nextRegEx.exec(links[i]);
                if (matches) {
                    url = matches[1];
                }
            }
        }
        return url;
    }

    function getRoster(courseId, url) {
        try {
            if (aborted) {
                throw new Error('Aborted');
            }
            pending++;
            $.getJSON(url, function(udata, status, jqXHR) {
                url = nextURL(jqXHR.getResponseHeader('Link'));
                for (var i = 0; i < udata.length; i++) {
                    var student = udata[i];
                    if (student.email && student.email.length > 0 && student.sis_user_id && student.name && student.enrollments) {
                        var studentData = {};
                        studentData.name = student.name;
                        studentData.id = student.id;
                        studentData.sis_user_id = student.sis_user_id;
                        studentData.sis_login_id = student.sis_user_id;
                        studentData.section = student.enrollments[0].sis_section_id;
                        studentData.email = student.email;
                    }
                    studentArr.push(studentData);
                }
                if (url) {
                    getRoster(courseId, url);
                }
                pending--;
                progressbar(0.5, 1);
                if (pending <= 0 && studentArr.length >= 1) {
                    makeCSV();
                }
            }).fail(function() {
                pending--;
                throw new Error('Failed to load list of students');
            });
        } catch (e) {
            errorHandler(e);
        }
    }

    function makeCSV() {
        try {
            if (aborted) {
                console.log('Process aborted');
                aborted = false;
                return;
            }
            progressbar();
            var csv = createCSV();
            if (csv) {
                var blob = new Blob([ csv ], {
                    'type' : 'text/csv;charset=utf-8'
                });
                var courseId = getCourseId();
                saveAs(blob, 'roster-' + courseId + '.csv');
                $('#site_roster').one('click', roster);
            } else {
                throw new Error('Problem creating report');
            }
        } catch (e) {
            errorHandler(e);
        }
    }

    function createCSV() {
        var fields = [ {
            'name' : 'Student',
            'src' : 'u.name'
        }, {
            'name' : 'ID',
            'src' : 'u.id'
        }, {
            'name' : 'SIS User ID',
            'src' : 'u.sis_user_id'
        }, {
            'name' : 'SIS Login ID',
            'src' : 'u.sis_user_id'
        }, {
            'name' : 'Section',
            'src' : 'u.section'
        }, {
            'name' : 'Email',
            'src' : 'u.email'
        } ];

        var CRLF = '\r\n';
        var hdr = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', 'Email'];
        var t = hdr.join(',') + CRLF;
        for (var i = 0; i < studentArr.length; i++) {
            var item = [];
            for (var key in studentArr[i]) {
                item.push(studentArr[i][key]);
            }
            t += item.join(',') + CRLF;
        }
        return t;
    }

    function progressbar(x, n) {
        try {
            if (typeof x === 'undefined' || typeof n == 'undefined') {
                if ($('#jj_progress_dialog').length === 0) {
                    $('body').append('<div id="jj_progress_dialog"></div>');
                    $('#jj_progress_dialog').append('<div id="jj_progressbar"></div>');
                    $('#jj_progress_dialog').dialog({
                        'title' : 'Fetching Site Roster',
                        'autoOpen' : false,
                        'buttons' : [ {
                            'text' : 'Cancel',
                            'click' : function() {
                                $(this).dialog('close');
                                aborted = true;
                                abortAll();
                                pending = -1;
                                $('#site_roster').one('click', roster);
                            }
                        } ]
                    });
                }
                if ($('#jj_progress_dialog').dialog('isOpen')) {
                    $('#jj_progress_dialog').dialog('close');
                } else {
                    $('#jj_progressbar').progressbar({
                        'value' : false
                    });
                    $('#jj_progress_dialog').dialog('open');
                }
            } else {
                if (!aborted) {
                    var val = n > 0 ? Math.round(100 * x / n) : false;
                    $('#jj_progressbar').progressbar('option', 'value', val);
                }
            }
        } catch (e) {
            errorHandler(e);
        }
    }

    function errorHandler(e) {
        console.log(e.name + ': ' + e.message);
    }
})();
