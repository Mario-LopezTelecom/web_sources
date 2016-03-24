$(document).ready(function(){
    $(".cv-heading").click(toggle_collapsible);
})

function toggle_collapsible() {
    var next_elem = $(this).next();
    var elems_of_section = $(this).nextUntil(".cv-heading");
        $(this).toggleClass("Down Up");
        elems_of_section.slideToggle("slow");

}




