// Country list (ISO 3166-1) plus state/province lists for the countries
// most likely to matter for Bizzux customers and their branches. There's no
// built-in JS API for subdivisions (unlike timezones/currencies — see
// lib/timezones.js / lib/currencies.js, which lean on Intl.supportedValuesOf
// instead of hand-maintained data), so exhaustively hand-typing every
// subdivision of all ~195 countries here would be a lot of surface area to
// get subtly wrong with no way to verify it. Instead: the country list
// itself is complete, and STATES_BY_COUNTRY has full state/province lists
// for major countries — everywhere else, the State field falls back to a
// free-text input instead of forcing an empty dropdown (see
// AddOrganizationForm in app/admin/page.js).
export const COUNTRIES = [
  ["AF", "Afghanistan"], ["AL", "Albania"], ["DZ", "Algeria"], ["AD", "Andorra"], ["AO", "Angola"],
  ["AG", "Antigua and Barbuda"], ["AR", "Argentina"], ["AM", "Armenia"], ["AU", "Australia"], ["AT", "Austria"],
  ["AZ", "Azerbaijan"], ["BS", "Bahamas"], ["BH", "Bahrain"], ["BD", "Bangladesh"], ["BB", "Barbados"],
  ["BY", "Belarus"], ["BE", "Belgium"], ["BZ", "Belize"], ["BJ", "Benin"], ["BT", "Bhutan"],
  ["BO", "Bolivia"], ["BA", "Bosnia and Herzegovina"], ["BW", "Botswana"], ["BR", "Brazil"], ["BN", "Brunei"],
  ["BG", "Bulgaria"], ["BF", "Burkina Faso"], ["BI", "Burundi"], ["KH", "Cambodia"], ["CM", "Cameroon"],
  ["CA", "Canada"], ["CV", "Cabo Verde"], ["CF", "Central African Republic"], ["TD", "Chad"], ["CL", "Chile"],
  ["CN", "China"], ["CO", "Colombia"], ["KM", "Comoros"], ["CG", "Congo"], ["CD", "Congo (DRC)"],
  ["CR", "Costa Rica"], ["CI", "Côte d'Ivoire"], ["HR", "Croatia"], ["CU", "Cuba"], ["CY", "Cyprus"],
  ["CZ", "Czechia"], ["DK", "Denmark"], ["DJ", "Djibouti"], ["DM", "Dominica"], ["DO", "Dominican Republic"],
  ["EC", "Ecuador"], ["EG", "Egypt"], ["SV", "El Salvador"], ["GQ", "Equatorial Guinea"], ["ER", "Eritrea"],
  ["EE", "Estonia"], ["SZ", "Eswatini"], ["ET", "Ethiopia"], ["FJ", "Fiji"], ["FI", "Finland"],
  ["FR", "France"], ["GA", "Gabon"], ["GM", "Gambia"], ["GE", "Georgia"], ["DE", "Germany"],
  ["GH", "Ghana"], ["GR", "Greece"], ["GD", "Grenada"], ["GT", "Guatemala"], ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"], ["GY", "Guyana"], ["HT", "Haiti"], ["HN", "Honduras"], ["HK", "Hong Kong"],
  ["HU", "Hungary"], ["IS", "Iceland"], ["IN", "India"], ["ID", "Indonesia"], ["IR", "Iran"],
  ["IQ", "Iraq"], ["IE", "Ireland"], ["IL", "Israel"], ["IT", "Italy"], ["JM", "Jamaica"],
  ["JP", "Japan"], ["JO", "Jordan"], ["KZ", "Kazakhstan"], ["KE", "Kenya"], ["KI", "Kiribati"],
  ["KW", "Kuwait"], ["KG", "Kyrgyzstan"], ["LA", "Laos"], ["LV", "Latvia"], ["LB", "Lebanon"],
  ["LS", "Lesotho"], ["LR", "Liberia"], ["LY", "Libya"], ["LI", "Liechtenstein"], ["LT", "Lithuania"],
  ["LU", "Luxembourg"], ["MO", "Macao"], ["MG", "Madagascar"], ["MW", "Malawi"], ["MY", "Malaysia"],
  ["MV", "Maldives"], ["ML", "Mali"], ["MT", "Malta"], ["MH", "Marshall Islands"], ["MR", "Mauritania"],
  ["MU", "Mauritius"], ["MX", "Mexico"], ["FM", "Micronesia"], ["MD", "Moldova"], ["MC", "Monaco"],
  ["MN", "Mongolia"], ["ME", "Montenegro"], ["MA", "Morocco"], ["MZ", "Mozambique"], ["MM", "Myanmar"],
  ["NA", "Namibia"], ["NR", "Nauru"], ["NP", "Nepal"], ["NL", "Netherlands"], ["NZ", "New Zealand"],
  ["NI", "Nicaragua"], ["NE", "Niger"], ["NG", "Nigeria"], ["KP", "North Korea"], ["MK", "North Macedonia"],
  ["NO", "Norway"], ["OM", "Oman"], ["PK", "Pakistan"], ["PW", "Palau"], ["PS", "Palestine"],
  ["PA", "Panama"], ["PG", "Papua New Guinea"], ["PY", "Paraguay"], ["PE", "Peru"], ["PH", "Philippines"],
  ["PL", "Poland"], ["PT", "Portugal"], ["QA", "Qatar"], ["RO", "Romania"], ["RU", "Russia"],
  ["RW", "Rwanda"], ["KN", "Saint Kitts and Nevis"], ["LC", "Saint Lucia"], ["VC", "Saint Vincent and the Grenadines"],
  ["WS", "Samoa"], ["SM", "San Marino"], ["ST", "Sao Tome and Principe"], ["SA", "Saudi Arabia"], ["SN", "Senegal"],
  ["RS", "Serbia"], ["SC", "Seychelles"], ["SL", "Sierra Leone"], ["SG", "Singapore"], ["SK", "Slovakia"],
  ["SI", "Slovenia"], ["SB", "Solomon Islands"], ["SO", "Somalia"], ["ZA", "South Africa"], ["KR", "South Korea"],
  ["SS", "South Sudan"], ["ES", "Spain"], ["LK", "Sri Lanka"], ["SD", "Sudan"], ["SR", "Suriname"],
  ["SE", "Sweden"], ["CH", "Switzerland"], ["SY", "Syria"], ["TW", "Taiwan"], ["TJ", "Tajikistan"],
  ["TZ", "Tanzania"], ["TH", "Thailand"], ["TL", "Timor-Leste"], ["TG", "Togo"], ["TO", "Tonga"],
  ["TT", "Trinidad and Tobago"], ["TN", "Tunisia"], ["TR", "Turkey"], ["TM", "Turkmenistan"], ["TV", "Tuvalu"],
  ["UG", "Uganda"], ["UA", "Ukraine"], ["AE", "United Arab Emirates"], ["GB", "United Kingdom"], ["US", "United States"],
  ["UY", "Uruguay"], ["UZ", "Uzbekistan"], ["VU", "Vanuatu"], ["VA", "Vatican City"], ["VE", "Venezuela"],
  ["VN", "Vietnam"], ["YE", "Yemen"], ["ZM", "Zambia"], ["ZW", "Zimbabwe"],
];

// Full state/province coverage for major countries; everywhere else the
// form falls back to a free-text State field. Keep this list alphabetized
// by country code within each entry for easy scanning/editing.
export const STATES_BY_COUNTRY = {
  IN: [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
    "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
  ],
  US: [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
    "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas",
    "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
    "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
    "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
    "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming",
  ],
  CA: [
    "Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Nova Scotia",
    "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Northwest Territories", "Nunavut", "Yukon",
  ],
  AU: [
    "New South Wales", "Queensland", "South Australia", "Tasmania", "Victoria", "Western Australia",
    "Australian Capital Territory", "Northern Territory",
  ],
  GB: ["England", "Scotland", "Wales", "Northern Ireland"],
  AE: ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"],
  DE: [
    "Baden-Württemberg", "Bavaria", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hesse",
    "Mecklenburg-Vorpommern", "Lower Saxony", "North Rhine-Westphalia", "Rhineland-Palatinate", "Saarland",
    "Saxony", "Saxony-Anhalt", "Schleswig-Holstein", "Thuringia",
  ],
  CH: [
    "Aargau", "Appenzell Innerrhoden", "Appenzell Ausserrhoden", "Basel-Landschaft", "Basel-Stadt", "Bern",
    "Fribourg", "Geneva", "Glarus", "Graubünden", "Jura", "Lucerne", "Neuchâtel", "Nidwalden", "Obwalden",
    "Schaffhausen", "Schwyz", "Solothurn", "St. Gallen", "Thurgau", "Ticino", "Uri", "Valais", "Vaud", "Zug",
    "Zürich",
  ],
  BR: [
    "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Espírito Santo", "Goiás",
    "Maranhão", "Mato Grosso", "Mato Grosso do Sul", "Minas Gerais", "Pará", "Paraíba", "Paraná",
    "Pernambuco", "Piauí", "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia",
    "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins",
  ],
  MX: [
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
    "Ciudad de México", "Coahuila", "Colima", "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco",
    "México", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro",
    "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz",
    "Yucatán", "Zacatecas",
  ],
  ZA: [
    "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "Northern Cape",
    "North West", "Western Cape",
  ],
  NG: [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River",
    "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Federal Capital Territory", "Gombe", "Imo", "Jigawa",
    "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo",
    "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
  ],
  SA: [
    "Riyadh", "Makkah", "Madinah", "Eastern Province", "Asir", "Tabuk", "Qassim", "Hail", "Northern Borders",
    "Jazan", "Najran", "Al Bahah", "Al Jouf",
  ],
  MY: [
    "Johor", "Kedah", "Kelantan", "Malacca", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis",
    "Sabah", "Sarawak", "Selangor", "Terengganu", "Kuala Lumpur", "Labuan", "Putrajaya",
  ],
  ID: [
    "Aceh", "Bali", "Bangka Belitung Islands", "Banten", "Bengkulu", "Central Java", "Central Kalimantan",
    "Central Sulawesi", "East Java", "East Kalimantan", "East Nusa Tenggara", "Gorontalo", "Jakarta",
    "Jambi", "Lampung", "Maluku", "North Kalimantan", "North Maluku", "North Sulawesi", "North Sumatra",
    "Papua", "Riau", "Riau Islands", "South Kalimantan", "South Sulawesi", "South Sumatra",
    "Southeast Sulawesi", "West Java", "West Kalimantan", "West Nusa Tenggara", "West Papua", "West Sulawesi",
    "West Sumatra", "Yogyakarta",
  ],
  PH: [
    "Ilocos Region", "Cagayan Valley", "Central Luzon", "Calabarzon", "Mimaropa", "Bicol Region",
    "Western Visayas", "Central Visayas", "Eastern Visayas", "Zamboanga Peninsula", "Northern Mindanao",
    "Davao Region", "Soccsksargen", "Caraga", "Bangsamoro", "Cordillera Administrative Region",
    "National Capital Region",
  ],
  PK: [
    "Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Gilgit-Baltistan", "Azad Kashmir",
    "Islamabad Capital Territory",
  ],
  BD: [
    "Barishal", "Chattogram", "Dhaka", "Khulna", "Mymensingh", "Rajshahi", "Rangpur", "Sylhet",
  ],
  LK: [
    "Central", "Eastern", "North Central", "Northern", "North Western", "Sabaragamuwa", "Southern",
    "Uva", "Western",
  ],
  NP: [
    "Koshi", "Madhesh", "Bagmati", "Gandaki", "Lumbini", "Karnali", "Sudurpashchim",
  ],
  NZ: [
    "Auckland", "Bay of Plenty", "Canterbury", "Gisborne", "Hawke's Bay", "Manawatū-Whanganui",
    "Marlborough", "Nelson", "Northland", "Otago", "Southland", "Taranaki", "Tasman", "Waikato",
    "Wellington", "West Coast",
  ],
  IT: [
    "Abruzzo", "Aosta Valley", "Apulia", "Basilicata", "Calabria", "Campania", "Emilia-Romagna",
    "Friuli Venezia Giulia", "Lazio", "Liguria", "Lombardy", "Marche", "Molise", "Piedmont", "Sardinia",
    "Sicily", "Trentino-Alto Adige", "Tuscany", "Umbria", "Veneto",
  ],
  ES: [
    "Andalusia", "Aragon", "Asturias", "Balearic Islands", "Basque Country", "Canary Islands", "Cantabria",
    "Castile and León", "Castilla-La Mancha", "Catalonia", "Extremadura", "Galicia", "La Rioja", "Madrid",
    "Murcia", "Navarre", "Valencian Community", "Ceuta", "Melilla",
  ],
  FR: [
    "Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Brittany", "Centre-Val de Loire", "Corsica",
    "Grand Est", "Hauts-de-France", "Île-de-France", "Normandy", "Nouvelle-Aquitaine", "Occitanie",
    "Pays de la Loire", "Provence-Alpes-Côte d'Azur",
  ],
  JP: [
    "Hokkaido", "Aomori", "Iwate", "Miyagi", "Akita", "Yamagata", "Fukushima", "Ibaraki", "Tochigi",
    "Gunma", "Saitama", "Chiba", "Tokyo", "Kanagawa", "Niigata", "Toyama", "Ishikawa", "Fukui", "Yamanashi",
    "Nagano", "Gifu", "Shizuoka", "Aichi", "Mie", "Shiga", "Kyoto", "Osaka", "Hyogo", "Nara", "Wakayama",
    "Tottori", "Shimane", "Okayama", "Hiroshima", "Yamaguchi", "Tokushima", "Kagawa", "Ehime", "Kochi",
    "Fukuoka", "Saga", "Nagasaki", "Kumamoto", "Oita", "Miyazaki", "Kagoshima", "Okinawa",
  ],
  CN: [
    "Beijing", "Tianjin", "Hebei", "Shanxi", "Inner Mongolia", "Liaoning", "Jilin", "Heilongjiang",
    "Shanghai", "Jiangsu", "Zhejiang", "Anhui", "Fujian", "Jiangxi", "Shandong", "Henan", "Hubei", "Hunan",
    "Guangdong", "Guangxi", "Hainan", "Chongqing", "Sichuan", "Guizhou", "Yunnan", "Tibet", "Shaanxi",
    "Gansu", "Qinghai", "Ningxia", "Xinjiang", "Hong Kong", "Macao", "Taiwan",
  ],
  AR: [
    "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba",
    "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones",
    "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero",
    "Tierra del Fuego", "Tucumán",
  ],
  KE: [
    "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Uasin Gishu", "Kiambu", "Machakos", "Kajiado",
    "Meru", "Kilifi", "Kakamega", "Bungoma", "Nyeri", "Kericho", "Trans Nzoia",
  ],
  EG: [
    "Cairo", "Alexandria", "Giza", "Qalyubia", "Sharqia", "Dakahlia", "Beheira", "Minya", "Assiut",
    "Sohag", "Aswan", "Luxor", "Red Sea", "Suez", "Ismailia", "Port Said", "Damietta", "Gharbia",
    "Monufia", "Kafr El Sheikh", "Beni Suef", "Fayoum", "New Valley", "Matrouh", "North Sinai", "South Sinai",
  ],
};
