
$(window).on("load", function () {

    function isPasswordFilled() {
        let isFilled = true;
        // Check passwords match and password is longer than 4
        if ($('input[type="password"][id="password"]').val() !== $('input[type="password"][id="confirmPassword"]').val() ||
            $('input[type="password"][id="password"]').val().length < 4 ||
            $('input[type="password"][id="confirmPassword"]').val().length < 4) {
            isFilled = false;
        }

        if ($('input[type="password"][id="password"]').val().length >= 1 && $('input[type="password"][id="confirmPassword"]').val().length >= 1) {
            if ($('input[type="password"][id="password"]').val().length < 4 && $('input[type="password"][id="confirmPassword"]').val().length < 4) {
                $("#passwordsMatch").html("<i class='icon times red'></i><span style='color: red'>Password is too short. Must be at least 4 characters long.</span>");
                $("#passwordsMatch").css("visibility", "visible");
            } else if ($('input[type="password"][id="password"]').val() !== $('input[type="password"][id="confirmPassword"]').val()) {
                $("#passwordsMatch").html("<i class='icon times red'></i><span style='color: red'>Passwords do not match.</span>");
                $("#passwordsMatch").css("visibility", "visible");
            } else {
                $("#passwordsMatch").html("<i class='icon check'></i><span>Passwords match.</span>");
                isFilled = true;
                $("#passwordsMatch").css("visibility", "visible");
            }
        } else {
            $("#passwordsMatch").css("visibility", "hidden");
        }
        return isFilled;
    }

    function enableSaveBtn() {
        let isFilled = true;
        console.log("1: ", isFilled);
        // Check Username and MTurkID is not blank
        $('#signup-form input[type="text"]').each(function () {
            if ($(this).val().trim().length === 0) {
                console.log("2: ", isFilled);
                isFilled = false;
            }
        })
        console.log("3: ", isFilled);
        // if ($('.tags-container .tag-item').length === 0) {
        //     isFilled = false;
        // };
        console.log("4: ", isFilled);
        // Check TOS is checked
        if (!$('.ui.checkbox').hasClass("checked")) {
            isFilled = false;
        }
        console.log("5: ", isFilled);
        // Check passwords match and password is longer than 4
        if (isPasswordFilled() && isFilled) {
            $('button.ui.button').addClass("green");
        } else {
            $('button.ui.button').removeClass("green");
        }
        console.log("6: ", isFilled);
    };

    // Sign Up FORM Button: Form validation to make Sign Up button green
    $('form[id="signup-form"] input').on('input', function () {
        enableSaveBtn();
    });
    $('form[id="signup-form"] input[type="hidden"]').on('change', function () {
        enableSaveBtn();
    });
    $('form[id="signup-form"] input[type="checkbox"]').on('change', function () {
        enableSaveBtn();
    });

    // Update Profile and Password FORM: Form validation
    $('.ui.selection.dropdown').dropdown({
        onChange: function (value, text, $selectedItem) {
            // Manually trigger change event on the hidden input
            $('input[name="topics"]').val(value).trigger('change');
        }
    });
    $('form[id="profile"] input, .ui.selection.dropdown').on('input change', function () {
        $('form[id="profile"] button').removeClass('disabled').addClass('green');
    });


    $('form[id="password"] input').on('input', function () {
        $('form[id="password"] button').removeClass('disabled');

        if (isPasswordFilled()) {
            $('form[id="password"] button').addClass("green");
        } else {
            $('form[id="password"] button').removeClass("green");
        }
    });



});

