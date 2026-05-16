// welcome.js - Holiday detection for welcome overlay

/**
 * Returns the appropriate holiday image URL based on current date.
 * Images should be placed in the 'assets' folder with these names.
 * Recommended image size: 1080x1920 pixels (9:16 portrait).
 */
export function getHolidayImage() {
    const today = new Date();
    const month = today.getMonth() + 1; // 1-12
    const day = today.getDate();


    // ==========================================
    // FLOATING DATES (Update these manually each year)
    // ==========================================
    
    // Easter: Update month and day each year
    const easterMonth = 4; 
    const easterDay = 5; 
    if (month === easterMonth && day === easterDay) {
        return 'assets/welcome-easter.jpg';
    }

    // Mother's Day: Update month and day each year
    const mothersDayMonth = 3;
    const mothersDayDay = 15;
    if (month === mothersDayMonth && day === mothersDayDay) {
        return 'assets/welcome-mothersday.jpg';
    }

    // Father's Day: Update month and day each year
    const fathersDayMonth = 6;
    const fathersDayDay = 21;
    if (month === fathersDayMonth && day === fathersDayDay) {
        return 'assets/welcome-fathersday.jpg';
    }


    // ==========================================
    // FIXED HOLIDAYS & SPECIAL DAYS
    // ==========================================

    // January
    if (month === 1 && day === 1) return 'assets/welcome-newyear.jpg'; // New Year's Day

    // February
    if (month === 2 && day === 1) return 'assets/welcome-newmonth.jpg';
    if (month === 2 && day === 14) return 'assets/welcome-valentine.jpg';

    // March
    if (month === 3 && day === 1) return 'assets/welcome-newmonth.jpg';
    if (month === 3 && day === 8) return 'assets/welcome-womensday.jpg';

    // April
    if (month === 4 && day === 1) return 'assets/welcome-aprilfools.jpg';
    if (month === 4 && day === 22) return 'assets/welcome-earthday.jpg';

    // May
    if (month === 5 && day === 1) return 'assets/welcome-workersday.jpg';
    if (month === 5 && day === 25) return 'assets/welcome-africaday.jpg';
    if (month === 5 && day === 27) return 'assets/welcome-childrensday.jpg';
    
    // June
    if (month === 6 && day === 1) return 'assets/welcome-newmonth.jpg';

    // July
    if (month === 7 && day === 1) return 'assets/welcome-newmonth.jpg';

    // August
    if (month === 8 && day === 1) return 'assets/welcome-newmonth.jpg';
    if (month === 8 && day === 12) return 'assets/welcome-youthday.jpg';

    // September
    if (month === 9 && day === 1) return 'assets/welcome-newmonth.jpg';

    // October
    if (month === 10 && day === 1) return 'assets/welcome-independence.jpg';
    if (month === 10 && day === 5) return 'assets/welcome-teachersday.jpg';
    if (month === 10 && day === 31) return 'assets/welcome-halloween.jpg';

    // November
    if (month === 11 && day === 1) return 'assets/welcome-newmonth.jpg';

    // December
    if (month === 12 && day === 1) return 'assets/welcome-newmonth.jpg';
    if (month === 12 && day === 24) return 'assets/welcome-christmaseve.jpg';
    if (month === 12 && day === 25) return 'assets/welcome-christmas.jpg';
    if (month === 12 && day === 26) return 'assets/welcome-boxingday.jpg';
    if (month === 12 && day === 31) return 'assets/welcome-newyearseve.jpg';


    // ==========================================
    // FALLBACK DEFAULT
    // ==========================================
    return 'assets/welcome-default.jpg';
}

/**
 * Returns a festive emoji version of "VidVids" based on the current date.
 */
export function getFestiveTitle() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    // Floating dates (same as in getHolidayImage)
    const easterMonth = 4, easterDay = 5;
    const mothersDayMonth = 3, mothersDayDay = 15;
    const fathersDayMonth = 6, fathersDayDay = 21;

    // Easter
    if (month === easterMonth && day === easterDay) return 'V🐣d🌸Vids';
    // Mother's Day
    if (month === mothersDayMonth && day === mothersDayDay) return 'V🌷d💐Vids';
    // Father's Day
    if (month === fathersDayMonth && day === fathersDayDay) return 'V👔d💪Vids';

    // Fixed holidays
    // January
    if (month === 1 && day === 1) return 'V🎆d✨Vids'; // New Year's Day

    // February
    if (month === 2 && day === 1) return 'V📅d🌟Vids'; // New Month
    if (month === 2 && day === 14) return 'V❤️d💕Vids'; // Valentine's Day

    // March
    if (month === 3 && day === 1) return 'V📅d🌟Vids'; // New Month
    if (month === 3 && day === 8) return 'V🌸d💃Vids'; // Women's Day

    // April
    if (month === 4 && day === 1) return 'V😂d🎭Vids'; // April Fools' Day
    if (month === 4 && day === 22) return 'V🌍d🌱Vids'; // Earth Day

    // May
    if (month === 5 && day === 1) return 'V🛠️d👷Vids'; // Workers' Day
    if (month === 5 && day === 25) return 'V🌍d✊Vids'; // Africa Day
    if (month === 5 && day === 27) return 'V🧸d🍭Vids'; // Children's Day

    // June
    if (month === 6 && day === 1) return 'V📅d🌟Vids'; // New Month

    // July
    if (month === 7 && day === 1) return 'V📅d🌟Vids'; // New Month

    // August
    if (month === 8 && day === 1) return 'V📅d🌟Vids'; // New Month
    if (month === 8 && day === 12) return 'V🧑‍🎓d🚀Vids'; // Youth Day

    // September
    if (month === 9 && day === 1) return 'V📅d🌟Vids'; // New Month

    // October
    if (month === 10 && day === 1) return 'V🇳🇬d🦅Vids'; // Independence Day (example)
    if (month === 10 && day === 5) return 'V🍎d📚Vids'; // Teachers' Day
    if (month === 10 && day === 31) return 'V🎃d👻Vids'; // Halloween

    // November
    if (month === 11 && day === 1) return 'V📅d🌟Vids'; // New Month

    // December
    if (month === 12 && day === 1) return 'V📅d🌟Vids'; // New Month
    if (month === 12 && day === 24) return 'V🎄d🕯️Vids'; // Christmas Eve
    if (month === 12 && day === 25) return 'V🎄d🎁Vids'; // Christmas Day
    if (month === 12 && day === 26) return 'V📦d🎁Vids'; // Boxing Day
    if (month === 12 && day === 31) return 'V🎆d🥂Vids'; // New Year's Eve

    // Default fallback
    return 'VidVids';
        }
