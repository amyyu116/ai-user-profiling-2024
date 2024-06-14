$(window).on("load", function () {
    $('.ui.tiny.post.modal').modal({
        observeChanges: true
    });

    // Add new post Modal functionality
    $("#newpost, a.item.newpost").click(function () {
        $('.ui.tiny.post.modal').modal('show');
    });

    $.fn.form.settings.rules.eitherBodyOrPic = function (value, fields) {
        return fields.body.trim() !== '' || fields.picinput !== '/public/photo-camera.svg';
    };

    // new post validator (picture and text can not be empty); using Fomantic UI
    $('#postform').form({
        on: 'blur',
        fields: {
            body: {
                identifier: 'body',
                rules: [{
                    type: 'empty',
                    prompt: 'Please add some text.'
                }]
            },
            picinput: {
                identifier: 'picinput',
                rules: [{
                    type: 'notExactly[/public/photo-camera.svg]',
                    prompt: 'Please click on the Camera Icon to add a photo.'
                }]
            }
        },
        onSuccess: function (event, fields) {
            $("#postform")[0].submit();
            $('.actions .ui.green.button').addClass('disabled');
            $('.actions .ui.green.button').val('Posting...');
        }
    });
});