// Curated Bollywood / Hindi movies. Format: title|year|difficulty (e=easy, m=medium, h=hard)
// Works in the browser (window.MOVIES) and in Node (require).
(function () {
  const RAW = `
Sholay|1975|e
Deewaar|1975|m
Zanjeer|1973|m
Amar Akbar Anthony|1977|m
Don|1978|e
Bobby|1973|e
Anand|1971|m
Chupke Chupke|1975|m
Golmaal|1979|e
Muqaddar Ka Sikandar|1978|h
Kabhi Kabhie|1976|m
Seeta Aur Geeta|1972|m
Yaadon Ki Baaraat|1973|h
Pakeezah|1972|h
Mr. India|1987|e
Tezaab|1988|m
Qayamat Se Qayamat Tak|1988|h
Maine Pyar Kiya|1989|e
Chandni|1989|m
Ram Lakhan|1989|m
Himmatwala|1983|m
Coolie|1983|e
Karma|1986|m
Ek Duuje Ke Liye|1981|h
Disco Dancer|1982|e
Namak Halaal|1982|h
Sharaabi|1984|m
Masoom|1983|m
Jaane Bhi Do Yaaro|1983|h
Betaab|1983|m
Tridev|1989|m
Ram Teri Ganga Maili|1985|h
Arjun|1985|m
Dilwale Dulhania Le Jayenge|1995|e
Kuch Kuch Hota Hai|1998|e
Hum Aapke Hain Koun|1994|m
Baazigar|1993|e
Darr|1993|e
Dil To Pagal Hai|1997|m
Kabhi Haan Kabhi Naa|1994|h
Karan Arjun|1995|m
Raja Hindustani|1996|m
Khal Nayak|1993|m
Hum Saath-Saath Hain|1999|h
Andaz Apna Apna|1994|m
Dil Hai Ke Manta Nahin|1991|h
Saajan|1991|m
Satya|1998|m
Rangeela|1995|m
Dil Se|1998|e
Sarfarosh|1999|m
Taal|1999|e
Pardes|1997|e
Border|1997|e
Hum Dil De Chuke Sanam|1999|h
Jo Jeeta Wohi Sikandar|1992|h
Coolie No. 1|1995|m
Ghulam|1998|m
Agneepath|1990|m
Lagaan|2001|e
Kabhi Khushi Kabhie Gham|2001|m
Dil Chahta Hai|2001|e
Kaho Naa Pyaar Hai|2000|m
Mohabbatein|2000|e
Hera Pheri|2000|e
Gadar Ek Prem Katha|2001|m
Devdas|2002|e
Kal Ho Naa Ho|2003|m
Koi Mil Gaya|2003|m
Munna Bhai M.B.B.S.|2003|m
Veer-Zaara|2004|m
Swades|2004|e
Dhoom|2004|e
Main Hoon Na|2004|m
Hum Tum|2004|e
Black|2005|e
Bunty Aur Babli|2005|m
Salaam Namaste|2005|m
Rang De Basanti|2006|m
Lage Raho Munna Bhai|2006|m
Krrish|2006|e
Kabhi Alvida Naa Kehna|2006|h
Fanaa|2006|e
Phir Hera Pheri|2006|m
Om Shanti Om|2007|m
Chak De India|2007|m
Jab We Met|2007|m
Welcome|2007|e
Bhool Bhulaiyaa|2007|m
Taare Zameen Par|2007|m
Ghajini|2008|e
Rab Ne Bana Di Jodi|2008|h
Jodhaa Akbar|2008|m
Dostana|2008|e
Singh Is Kinng|2008|m
Race|2008|e
3 Idiots|2009|e
Wake Up Sid|2009|m
Love Aaj Kal|2009|m
Paa|2009|e
Dabangg|2010|e
Golmaal 3|2010|m
Housefull|2010|e
My Name Is Khan|2010|m
Zindagi Na Milegi Dobara|2011|h
Bodyguard|2011|e
Ek Tha Tiger|2012|m
Barfi|2012|e
Gangs of Wasseypur|2012|m
Kahaani|2012|e
Student of the Year|2012|m
Yeh Jawaani Hai Deewani|2013|m
Chennai Express|2013|m
Dhoom 3|2013|e
Krrish 3|2013|e
Bhaag Milkha Bhaag|2013|m
Ram-Leela|2013|m
Raanjhanaa|2013|e
Aashiqui 2|2013|e
Queen|2014|e
Kick|2014|e
PK|2014|e
Happy New Year|2014|m
Haider|2014|e
Bajrangi Bhaijaan|2015|m
Bajirao Mastani|2015|m
Piku|2015|e
Tanu Weds Manu Returns|2015|h
Dum Laga Ke Haisha|2015|h
Tamasha|2015|e
Dangal|2016|e
Sultan|2016|e
Ae Dil Hai Mushkil|2016|h
Neerja|2016|e
Udta Punjab|2016|m
Dear Zindagi|2016|m
Tiger Zinda Hai|2017|m
Golmaal Again|2017|m
Toilet Ek Prem Katha|2017|h
Secret Superstar|2017|m
Raees|2017|e
Hindi Medium|2017|m
Padmaavat|2018|e
Sanju|2018|e
Stree|2018|e
Andhadhun|2018|m
Raazi|2018|e
Badhaai Ho|2018|m
Simmba|2018|e
Pad Man|2018|e
Veere Di Wedding|2018|h
Zero|2018|e
Kabir Singh|2019|e
Uri The Surgical Strike|2019|m
Gully Boy|2019|m
War|2019|e
Chhichhore|2019|m
Super 30|2019|e
Tanhaji|2020|e
Shershaah|2021|e
Sooryavanshi|2021|m
Sardar Udham|2021|m
Pathaan|2023|e
Jawan|2023|e
Animal|2023|e
Gadar 2|2023|e
Rocky Aur Rani Kii Prem Kahaani|2023|h
Drishyam 2|2022|e
Brahmastra|2022|e
Bhool Bhulaiyaa 2|2022|m
Gangubai Kathiawadi|2022|m
The Kashmir Files|2022|m
Dunki|2023|e
Tiger 3|2023|e
12th Fail|2023|m
Fighter|2024|e
Stree 2|2024|e
Laapataa Ladies|2024|m
Singham Again|2024|m
Chhaava|2025|e
`;
  const eraOf = (y) => Math.floor(y / 10) * 10 + 's';
  const DIFF = { e: 'easy', m: 'medium', h: 'hard' };
  const MOVIES = RAW.trim().split('\n').map((line) => {
    const [title, year, d] = line.split('|');
    return {
      title,
      year: +year,
      difficulty: DIFF[d],
      era: eraOf(+year),
      wordCount: title.replace(/[.\-]/g, ' ').split(/\s+/).filter(Boolean).length,
    };
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = MOVIES;
  else window.MOVIES = MOVIES;
})();
