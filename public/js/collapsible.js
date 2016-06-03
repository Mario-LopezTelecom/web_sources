$(document).ready(function(){
    $(".cv-heading").nextUntil(".cv-heading").hide();
    $(".cv-heading").click(toggle_collapsible);
})

function toggle_collapsible() {
    $(this).nextUntil(".cv-heading").slideToggle("slow");
}




